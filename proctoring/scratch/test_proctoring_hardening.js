'use strict'

const http = require('http')
const assert = require('assert')
const jwt = require('jsonwebtoken')
const WebSocket = require('ws')
const app = require('../src/app')
const env = require('../src/config/env')
const db = require('../src/db')
const migrate = require('../src/db/migrate')
const sessionService = require('../src/services/session.service')
const incidentService = require('../src/services/incident.service')
const reviewService = require('../src/services/review.service')
const riskService = require('../src/services/risk.service')
const { initWebSocket } = require('../src/websocket')
const { eventWorker, redisConnection: workerRedis } = require('../src/workers/event.worker')
const eventService = require('../src/services/event.service')

const TEST_PORT = 7998
const jwtSecret = env.JWT_SECRET

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function cleanDB() {
  console.log('[test] Cleaning database...')
  await db.query('DELETE FROM proctoring_reviews')
  await db.query('DELETE FROM proctoring_session_reviews')
  await db.query('DELETE FROM proctoring_incidents')
  await db.query('DELETE FROM proctoring_events')
  await db.query('DELETE FROM proctoring_sessions')
  await db.query('DELETE FROM answers')
  await db.query('DELETE FROM attempts')
  await db.query('DELETE FROM students')
}

async function seedData(studentId, attemptId, assessmentId) {
  console.log('[test] Seeding student and attempt...')
  await db.query(
    `INSERT INTO students (id, name, access_code, question_set_id)
     VALUES ($1, 'Hardening Student', 'HARDENACCESS', $2)`,
    [studentId, assessmentId]
  )
  await db.query(
    `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
     VALUES ($1, $2, now(), 7200)`,
     [attemptId, studentId]
  )
}

async function runTests() {
  console.log('--- STARTING PROCTORING HARDENING INTEGRATION TESTS ---')

  await migrate()
  await cleanDB()

  const studentId = 'aa111111-1111-1111-1111-111111111111'
  const attemptId = 'bb222222-2222-2222-2222-222222222222'
  const assessmentId = 'cc333333-3333-3333-3333-333333333333'
  await seedData(studentId, attemptId, assessmentId)

  // Start HTTP + WebSocket Server
  const server = http.createServer(app)
  const wss = initWebSocket(server)
  await new Promise((resolve) => server.listen(TEST_PORT, resolve))
  console.log(`[test] Server running on port :${TEST_PORT}`)

  const studentToken = jwt.sign({ studentId, attemptId }, jwtSecret)

  try {
    // ── TEST 1: WebSocket Reconnection & Connection Replacement ────────────────────
    console.log('\n[TEST 1] Testing Connection Replacement Registry...')
    const session = await sessionService.createSession({
      assessmentSessionId: attemptId,
      candidateId: studentId,
      assessmentId
    })

    const wsUrl = `ws://localhost:${TEST_PORT}/ws/proctoring/${session.id}?token=${studentToken}`
    
    // Connect Socket A
    const wsA = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      wsA.on('open', resolve)
      wsA.on('error', reject)
    })
    console.log('[ws-client] Socket A connected.')

    // Connect Socket B (should trigger code 4009 closing Socket A)
    let socketAClosedWithCode = null
    wsA.on('close', (code, reason) => {
      socketAClosedWithCode = code
      console.log(`[ws-client] Socket A closed. Code: ${code}, Reason: ${reason}`)
    })

    const wsB = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      wsB.on('open', resolve)
      wsB.on('error', reject)
    })
    console.log('[ws-client] Socket B connected. Waiting for Socket A closure...')

    await sleep(500)
    assert.strictEqual(socketAClosedWithCode, 4009, 'Socket A should be closed with code 4009 Replaced by new connection')
    console.log('✓ Connection Replacement Registry PASSED')

    // Clean up WS B
    wsB.close()
    await sleep(200)

    // ── TEST 2: Event Idempotency & Duplicate ACK ───────────────────────────────
    console.log('\n[TEST 2] Testing Event Idempotency & Duplicate ACK...')
    const attemptId2 = '00000000-0000-0000-0000-000000000002'
    await db.query(
      `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
       VALUES ($1, $2, now(), 7200)`,
       [attemptId2, studentId]
    )
    const session2 = await sessionService.createSession({
      assessmentSessionId: attemptId2,
      candidateId: studentId,
      assessmentId
    })
    const token2 = jwt.sign({ studentId, attemptId: attemptId2 }, jwtSecret)
    const wsUrl2 = `ws://localhost:${TEST_PORT}/ws/proctoring/${session2.id}?token=${token2}`

    const wsC = new WebSocket(wsUrl2)
    wsC.on('error', (err) => console.error('[ws-client-C-error]', err))
    wsC.on('close', (code, reason) => console.log('[ws-client-C-close]', code, reason.toString()))
    
    let responses = []
    let onConnectedResolve
    const connectedPromise = new Promise((resolve) => {
      onConnectedResolve = resolve
    })

    wsC.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      responses.push(msg)
      if (msg.event === 'CONNECTED') {
        onConnectedResolve()
      }
    })

    await connectedPromise

    // Send original event
    wsC.send(JSON.stringify({
      clientEventId: 'evt_dup_test',
      type: 'TAB_HIDDEN',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: 1
    }))

    await sleep(1000) // let queue process
    console.log('[test] Responses received so far:', responses)
    assert.strictEqual(responses.length, 2, 'Should receive CONNECTED and ACK') // CONNECTED + ACK
    assert.strictEqual(responses[1].event, 'ACK')
    assert.strictEqual(responses[1].duplicate, undefined)

    // Send duplicate event (same clientEventId)
    wsC.send(JSON.stringify({
      clientEventId: 'evt_dup_test',
      type: 'TAB_HIDDEN',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: 1
    }))

    await sleep(1500) // let worker process and discard duplicate database insert
    console.log('[test] Responses after duplicate:', responses)
    assert.strictEqual(responses.length, 3)
    assert.strictEqual(responses[2].event, 'ACK')
    assert.strictEqual(responses[2].duplicate, true, 'Should receive ACK with duplicate: true')

    // Assert that the risk score was only incremented ONCE (Tab switch count = 1, risk score = 5)
    const updatedSession = await sessionService.getSessionById(session2.id)
    assert.strictEqual(updatedSession.tabSwitchCount, 1, 'Tab switch count must be 1')
    assert.strictEqual(updatedSession.riskScore, 5, 'Risk score must remain 5')
    console.log('✓ Idempotency and Duplicate ACK assertions PASSED')

    wsC.close()
    await sleep(200)

    // ── TEST 3: Dynamic Sequence Gap Analysis ───────────────────────────────────
    console.log('\n[TEST 3] Testing Dynamic Sequence Gap Analysis...')
    const sessionGap = await sessionService.createSession({
      assessmentSessionId: '11112222-3333-4444-5555-666677778888',
      candidateId: studentId,
      assessmentId
    })

    // Insert events directly: sequence 1, 2, 4 (missing 3)
    await db.query(
      `INSERT INTO proctoring_events (proctoring_session_id, type, client_timestamp, sequence_number, client_event_id)
       VALUES ($1, 'TAB_HIDDEN', now(), 1, 'evt_g_1'),
              ($1, 'TAB_HIDDEN', now(), 2, 'evt_g_2'),
              ($1, 'TAB_HIDDEN', now(), 4, 'evt_g_4')`,
      [sessionGap.id]
    )

    let summary = await sessionService.getSessionSummary(sessionGap.id)
    assert.strictEqual(summary.sequenceGap, true, 'Sequence gap should be detected')
    assert.deepStrictEqual(summary.missingSequences, [3], 'Missing sequences array should contain [3]')
    assert.strictEqual(summary.expectedEventsCount, 4, 'Expected count should be 4')
    assert.strictEqual(summary.receivedEventsCount, 3, 'Received count should be 3')

    // Heal the gap by sending sequence 3
    await db.query(
      `INSERT INTO proctoring_events (proctoring_session_id, type, client_timestamp, sequence_number, client_event_id)
       VALUES ($1, 'TAB_HIDDEN', now(), 3, 'evt_g_3')`,
      [sessionGap.id]
    )

    summary = await sessionService.getSessionSummary(sessionGap.id)
    assert.strictEqual(summary.sequenceGap, false, 'Sequence gap should be healed')
    assert.deepStrictEqual(summary.missingSequences, [], 'Missing sequences should be empty')
    assert.strictEqual(summary.expectedEventsCount, 4, 'Expected count should be 4')
    assert.strictEqual(summary.receivedEventsCount, 4, 'Received count should be 4')
    console.log('✓ Dynamic Sequence Gap Analysis PASSED')

    // ── TEST 4: Idempotent Session Finalization & Late Events ───────────────────
    console.log('\n[TEST 4] Testing Session Finalization & Late Events...')
    
    // Create a fresh session for finalization tests
    const attemptId4 = '00000000-0000-0000-0000-000000000004'
    await db.query(
      `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
       VALUES ($1, $2, now(), 7200)`,
       [attemptId4, studentId]
    )
    const session4 = await sessionService.createSession({
      assessmentSessionId: attemptId4,
      candidateId: studentId,
      assessmentId
    })
    const token4 = jwt.sign({ studentId, attemptId: attemptId4 }, jwtSecret)
    const wsUrl4 = `ws://localhost:${TEST_PORT}/ws/proctoring/${session4.id}?token=${token4}`

    // Connect WebSocket BEFORE ending the session
    const wsD = new WebSocket(wsUrl4)
    let lateResponses = []
    let onConnectedResolveD
    const connectedPromiseD = new Promise((resolve) => {
      onConnectedResolveD = resolve
    })

    wsD.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      lateResponses.push(msg)
      if (msg.event === 'CONNECTED') {
        onConnectedResolveD()
      }
    })

    await connectedPromiseD

    // Now finalize the session
    const endRes1 = await sessionService.endSession(session4.id)
    assert.strictEqual(endRes1.status, 'ENDED')
    const initialEndedAt = endRes1.endedAt.getTime()

    await sleep(200)

    // Finalize again (idempotent)
    const endRes2 = await sessionService.endSession(session4.id)
    assert.strictEqual(endRes2.status, 'ENDED')
    assert.strictEqual(endRes2.endedAt.getTime(), initialEndedAt, 'ended_at must remain unchanged')

    // Send a late event over the already open socket
    wsD.send(JSON.stringify({
      clientEventId: 'evt_late',
      type: 'TAB_HIDDEN',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: 2
    }))

    await sleep(1500)
    // The worker should record the event as LATE_EVENT, standardizing metadata
    const events = await eventService.getEventsBySession(session4.id)
    const lateEvent = events.find(e => e.clientEventId === 'evt_late')
    
    assert.ok(lateEvent, 'Late event should be persisted')
    assert.strictEqual(lateEvent.type, 'LATE_EVENT', 'Late event type must be LATE_EVENT')
    assert.strictEqual(lateEvent.metadata.originalType, 'TAB_HIDDEN')
    assert.strictEqual(lateEvent.metadata.reason, 'SESSION_ENDED')

    // Verify late event did NOT change counters, risk score, or trigger incidents
    const finalizedSession = await sessionService.getSessionById(session4.id)
    assert.strictEqual(finalizedSession.tabSwitchCount, 0, 'Tab switch count must not change')
    assert.strictEqual(finalizedSession.riskScore, 0, 'Risk score must not change')
    
    console.log('✓ Idempotent Finalization and Late Events policy PASSED')
    wsD.close()

    // ── TEST 5: Risk Scoring Boundaries & Monotonicity ──────────────────────────
    console.log('\n[TEST 5] Testing Risk Boundaries & Monotonicity...')
    const sessionRisk = await sessionService.createSession({
      assessmentSessionId: '99999999-9999-9999-9999-999999999999',
      candidateId: studentId,
      assessmentId
    })

    // We calculate risk score manually by modifying session database counters directly
    // and asserting boundary levels
    const testBoundaries = async (counters, expectedScore, expectedLevel) => {
      await db.query(
        `UPDATE proctoring_sessions
         SET tab_switch_count = $1, fullscreen_exit_count = $2, copy_count = $3, paste_count = $4,
             camera_interruptions = $5, screen_interruptions = $6
         WHERE id = $7`,
        [...counters, sessionRisk.id]
      )
      const res = await riskService.calculateAndUpdateSessionRisk(sessionRisk.id)
      assert.strictEqual(res.riskScore, expectedScore, `Expected score ${expectedScore}, got ${res.riskScore}`)
      assert.strictEqual(res.riskLevel, expectedLevel, `Expected level ${expectedLevel}, got ${res.riskLevel}`)
    }

    // 0 -> LOW
    await testBoundaries([0, 0, 0, 0, 0, 0], 0, 'LOW')
    // 19 -> LOW
    await testBoundaries([3, 0, 2, 0, 0, 0], 19, 'LOW')
    // 20 -> MEDIUM boundary
    await testBoundaries([4, 0, 0, 0, 0, 0], 20, 'MEDIUM')
    // 39 -> MEDIUM
    await testBoundaries([3, 2, 1, 0, 0, 0], 38, 'MEDIUM')
    // 40 -> HIGH boundary
    await testBoundaries([0, 4, 0, 0, 0, 0], 47, 'HIGH')
    // 69 -> HIGH
    // Wait, let's use a combination that results in 68 or similar:
    // e.g. 10 tab switches (50) + 9 copy (18) = 68.
    await testBoundaries([10, 0, 9, 0, 0, 0], 68, 'HIGH')
    // 70 -> CRITICAL boundary
    await testBoundaries([14, 0, 0, 0, 0, 0], 70, 'CRITICAL')
    // 100 -> CRITICAL
    await testBoundaries([20, 0, 0, 0, 0, 0], 100, 'CRITICAL')

    console.log('✓ Risk Scoring Boundaries PASSED')

    // ── TEST 6: Append-Only Integrity Reviews ──────────────────────────────────
    console.log('\n[TEST 6] Testing Append-Only Integrity Reviews...')
    const teacher1 = 'dd444444-4444-4444-4444-444444444444'
    const teacher2 = 'ee555555-5555-5555-5555-555555555555'

    // Create overall review 1
    const rev1 = await reviewService.createSessionReview({
      sessionId: session.id,
      teacherId: teacher1,
      decision: 'SUSPICIOUS',
      comment: 'Appears suspicious.'
    })
    assert.strictEqual(rev1.decision, 'SUSPICIOUS')

    // Create overall review 2 (overwrites decision for current, but appends in history)
    const rev2 = await reviewService.createSessionReview({
      sessionId: session.id,
      teacherId: teacher2,
      decision: 'VALID',
      comment: 'Valid after explanation.'
    })
    assert.strictEqual(rev2.decision, 'VALID')

    // Verify GET /api/v1/sessions/:id/review history
    const historyRes = await reviewService.getSessionReviews(session.id)
    assert.strictEqual(historyRes.length, 2, 'History must contain 2 reviews')
    assert.strictEqual(historyRes[0].decision, 'VALID')
    assert.strictEqual(historyRes[1].decision, 'SUSPICIOUS')
    console.log('✓ Append-Only Integrity Reviews PASSED')

  } finally {
    // Shutdown
    server.close()
    await eventWorker.close()
    await workerRedis.quit()
    await eventService.redisConnection.quit()
    await db.pool.end()
  }

  console.log('\n--- ALL PROCTORING HARDENING TESTS PASSED SUCCESSFULLY! ---')
}

runTests().catch((err) => {
  console.error('[test-runner] HARDENING TEST SUITE FAILED:', err)
  process.exit(1)
})
