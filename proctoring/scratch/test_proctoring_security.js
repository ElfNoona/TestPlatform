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
const eventService = require('../src/services/event.service')
const { initWebSocket } = require('../src/websocket')

const TEST_PORT = 7995
const jwtSecret = env.JWT_SECRET

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function cleanDB() {
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
  await db.query(
    `INSERT INTO students (id, name, access_code, question_set_id)
     VALUES ($1, 'Security Student', 'SECACCESS', $2)`,
    [studentId, assessmentId]
  )
  await db.query(
    `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
     VALUES ($1, $2, now(), 7200)`,
     [attemptId, studentId]
  )
}

async function runTests() {
  console.log('--- STARTING PROCTORING SECURITY & RATE LIMIT TESTS ---')

  const { eventWorker, redisConnection: workerRedis } = require('../src/workers/event.worker')

  await migrate()
  await cleanDB()

  const studentId = '00000000-0000-0000-0000-000000000101'
  const attemptId = '00000000-0000-0000-0000-000000000202'
  const assessmentId = '00000000-0000-0000-0000-000000000303'
  await seedData(studentId, attemptId, assessmentId)

  // Start HTTP + WS Server
  const server = http.createServer(app)
  const wss = initWebSocket(server)
  await new Promise((resolve) => server.listen(TEST_PORT, resolve))
  console.log(`[test] Server running on port :${TEST_PORT}`)

  const validToken = jwt.sign({ studentId, attemptId }, jwtSecret)

  try {
    const session = await sessionService.createSession({
      assessmentSessionId: attemptId,
      candidateId: studentId,
      assessmentId
    })

    // ── TEST 1: Rejection of Invalid Token ──────────────────────────────────────
    console.log('\n[TEST 1] Testing Invalid Token Rejection...')
    const wsInvalid = new WebSocket(`ws://localhost:${TEST_PORT}/ws/proctoring/${session.id}?token=badtoken`)
    let invalidCloseCode = null
    await new Promise((resolve) => {
      wsInvalid.on('close', (code, reason) => {
        console.log('[test] Closed wsInvalid with:', code, reason.toString())
        invalidCloseCode = code
        resolve()
      })
      wsInvalid.on('error', (err) => {
        console.log('[test] wsInvalid error:', err.message)
        resolve()
      })
    })
    assert.strictEqual(invalidCloseCode, 4001, 'Should close with code 4001 for invalid token')
    console.log('✓ Invalid token rejected with code 4001.')

    // ── TEST 2: Rejection of Expired Token ──────────────────────────────────────
    console.log('\n[TEST 2] Testing Expired Token Rejection...')
    const expiredToken = jwt.sign({ studentId, attemptId }, jwtSecret, { expiresIn: '-10s' })
    const wsExpired = new WebSocket(`ws://localhost:${TEST_PORT}/ws/proctoring/${session.id}?token=${expiredToken}`)
    let expiredCloseCode = null
    await new Promise((resolve) => {
      wsExpired.on('close', (code) => {
        expiredCloseCode = code
        resolve()
      })
      wsExpired.on('error', () => resolve())
    })
    assert.strictEqual(expiredCloseCode, 4001, 'Should close with code 4001 for expired token')
    console.log('✓ Expired token rejected with code 4001.')

    // ── TEST 3: Session Boundary Cross-Talk ─────────────────────────────────────
    console.log('\n[TEST 3] Testing Session Boundary Cross-Talk Rejection...')
    // Connect using Token for Session X but to session URL for Session Y (not matching attemptId)
    const wsCross = new WebSocket(`ws://localhost:${TEST_PORT}/ws/proctoring/00000000-0000-0000-0000-000000000000?token=${validToken}`)
    let crossCloseCode = null
    await new Promise((resolve) => {
      wsCross.on('close', (code) => {
        crossCloseCode = code
        resolve()
      })
      wsCross.on('error', () => resolve())
    })
    assert.ok([4004, 4005, 1006].includes(crossCloseCode) || crossCloseCode === null, 'Should reject cross-talk/non-existent session')
    console.log('✓ Session boundary breach connection rejected.')

    // ── TEST 4: Action Event Rate Limiting & Auto-Disconnection ─────────────────
    console.log('\n[TEST 4] Testing Action Event Rate Limiting & Auto-Disconnection...')
    const wsRate = new WebSocket(`ws://localhost:${TEST_PORT}/ws/proctoring/${session.id}?token=${validToken}`)
    
    let responses = []
    let onConnected
    const connectedPromise = new Promise((resolve) => { onConnected = resolve })
    
    let rateClosedCode = null
    const closePromise = new Promise((resolve) => {
      wsRate.on('close', (code) => {
        rateClosedCode = code
        resolve()
      })
    })

    wsRate.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      responses.push(msg)
      if (msg.event === 'CONNECTED') onConnected()
    })

    await connectedPromise

    // Emitting 20 valid actions (limit is 20 per 5 seconds)
    console.log('[test] Emitting 20 valid action events...')
    for (let i = 0; i < 20; i++) {
      wsRate.send(JSON.stringify({
        clientEventId: `evt_rate_valid_${i}`,
        type: 'TAB_HIDDEN',
        clientTimestamp: new Date().toISOString(),
        sequenceNumber: i + 1
      }))
    }

    await sleep(500)
    const acksCount = responses.filter(r => r.event === 'ACK').length
    assert.strictEqual(acksCount, 20, 'Should successfully ACK 20 events')

    // Emit 5 more actions immediately (should trigger rate limit response and auto-close on the 5th violation)
    console.log('[test] Emitting 5 more events to trigger rate limiter...')
    for (let i = 0; i < 5; i++) {
      wsRate.send(JSON.stringify({
        clientEventId: `evt_rate_limited_${i}`,
        type: 'TAB_HIDDEN',
        clientTimestamp: new Date().toISOString(),
        sequenceNumber: i + 21
      }))
    }

    // Wait for auto-disconnection
    await closePromise
    assert.strictEqual(rateClosedCode, 4010, 'Socket must be closed with 4010 after persistent rate limit flooding')

    const rateLimitedResponses = responses.filter(r => r.event === 'ERROR' && r.code === 'RATE_LIMITED')
    assert.strictEqual(rateLimitedResponses.length, 5, 'Should receive 5 RATE_LIMITED error responses')
    
    // Check if the rate limited messages were ACKed (they must not be ACKed)
    const totalAcksAfterFlood = responses.filter(r => r.event === 'ACK').length
    assert.strictEqual(totalAcksAfterFlood, 20, 'Must NOT ACK rate-limited events')

    console.log('✓ Rate limiting and auto-disconnection policies PASSED.')

    // ── TEST 5: Heartbeat Validation ──────────────────────────────────────────
    console.log('\n[TEST 5] Testing Heartbeat Rate Limiting...')
    const wsHb = new WebSocket(`ws://localhost:${TEST_PORT}/ws/proctoring/${session.id}?token=${validToken}`)
    let hbResponses = []
    let onConnectedHb
    const connectedHbPromise = new Promise((resolve) => { onConnectedHb = resolve })
    
    wsHb.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      hbResponses.push(msg)
      if (msg.event === 'CONNECTED') onConnectedHb()
    })

    await connectedHbPromise

    // Send first heartbeat
    wsHb.send(JSON.stringify({
      clientEventId: 'evt_hb_1',
      type: 'HEARTBEAT',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: 1
    }))

    await sleep(200)
    const hbAcks = hbResponses.filter(r => r.event === 'HEARTBEAT_ACK')
    assert.strictEqual(hbAcks.length, 1, 'Should ACK first heartbeat')

    // Send second heartbeat immediately within 8 seconds
    wsHb.send(JSON.stringify({
      clientEventId: 'evt_hb_2',
      type: 'HEARTBEAT',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: 2
    }))

    await sleep(200)
    const hbLimited = hbResponses.filter(r => r.event === 'ERROR' && r.code === 'RATE_LIMITED')
    assert.strictEqual(hbLimited.length, 1, 'Second heartbeat must be rate-limited')
    console.log('✓ Heartbeat interval validation PASSED.')

    wsHb.close()

  } finally {
    server.close()
    await eventWorker.close()
    await workerRedis.quit()
    await eventService.redisConnection.quit()
    await db.pool.end()
  }

  console.log('\n--- ALL PROCTORING SECURITY & RATE LIMIT TESTS PASSED! ---')
}

runTests().catch((err) => {
  console.error('[test-runner] SECURITY TESTS FAILED:', err)
  process.exit(1)
})
