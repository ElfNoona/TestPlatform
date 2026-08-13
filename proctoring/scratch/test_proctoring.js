'use strict'

const http = require('http')
const jwt = require('jsonwebtoken')
const WebSocket = require('ws')
const app = require('../src/app')
const env = require('../src/config/env')
const db = require('../src/db')
const migrate = require('../src/db/migrate')
const sessionService = require('../src/services/session.service')
const incidentService = require('../src/services/incident.service')
const reviewService = require('../src/services/review.service')
const { initWebSocket } = require('../src/websocket')

// Import worker to register BullMQ consumer
const { eventWorker, redisConnection: workerRedis } = require('../src/workers/event.worker')
const eventService = require('../src/services/event.service')

const TEST_PORT = 7999
const jwtSecret = env.JWT_SECRET

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTests() {
  console.log('--- STARTING PROCTORING BACKEND INTEGRATION TESTS ---')

  // 1. Ensure schema bootstrap
  await migrate()

  // 2. Clear old test data
  console.log('[test] Cleaning test database tables...')
  await db.query('DELETE FROM proctoring_reviews')
  await db.query('DELETE FROM proctoring_incidents')
  await db.query('DELETE FROM proctoring_events')
  await db.query('DELETE FROM proctoring_sessions')
  await db.query('DELETE FROM answers')
  await db.query('DELETE FROM attempts')
  await db.query('DELETE FROM students')

  // 3. Seed student & attempt
  console.log('[test] Seeding database with test student and attempt...')
  const studentId = '11111111-1111-1111-1111-111111111111'
  const attemptId = '22222222-2222-2222-2222-222222222222'
  const assessmentId = '33333333-3333-3333-3333-333333333333'

  await db.query(
    `INSERT INTO students (id, name, access_code, question_set_id)
     VALUES ($1, 'John Doe Test', 'TESTACCESS999', $2)`,
    [studentId, assessmentId]
  )

  await db.query(
    `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
     VALUES ($1, $2, now(), 7200)`,
    [attemptId, studentId]
  )

  // 4. Start session via SessionService
  console.log('[test] Creating proctoring session...')
  const session = await sessionService.createSession({
    assessmentSessionId: attemptId,
    candidateId: studentId,
    assessmentId
  })

  if (!session || !session.id) {
    throw new Error('Failed to create session')
  }
  console.log('[test] Session created in DB:', session.id)

  // 5. Generate Student Token
  const studentToken = jwt.sign({ studentId, attemptId }, jwtSecret)

  // 6. Launch HTTP + WS Server on test port
  console.log(`[test] Launching test server on port :${TEST_PORT}...`)
  const server = http.createServer(app)
  initWebSocket(server)

  await new Promise((resolve) => server.listen(TEST_PORT, resolve))

  // 7. Connect client WebSocket
  console.log('[test] Connecting WebSocket client...')
  const wsUrl = `ws://localhost:${TEST_PORT}/ws/proctoring/${session.id}?token=${studentToken}`
  const ws = new WebSocket(wsUrl)

  const messagesReceived = []
  let onConnectedResolve
  const connectedPromise = new Promise((resolve) => {
    onConnectedResolve = resolve
  })

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    console.log('[ws-client-received]', msg)
    messagesReceived.push(msg)
    if (msg.event === 'CONNECTED') {
      onConnectedResolve()
    }
  })

  ws.on('close', (code, reason) => {
    console.log('[ws-client-close] closed with code:', code, 'reason:', reason.toString())
  })

  ws.on('error', (err) => {
    console.error('[ws-client-error] error:', err)
  })

  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  console.log('[test] WebSocket client open, waiting for CONNECTED handshake...')
  await connectedPromise
  console.log('[test] CONNECTED handshake received! Emitting test events over WebSocket...')

  // Event 1: Heartbeat
  ws.send(JSON.stringify({
    eventId: 'evt_1',
    type: 'HEARTBEAT',
    clientTimestamp: new Date().toISOString(),
    sequenceNumber: 1
  }))

  // Event 2: Tab hidden (switch tab)
  ws.send(JSON.stringify({
    eventId: 'evt_2',
    type: 'TAB_HIDDEN',
    clientTimestamp: new Date().toISOString(),
    sequenceNumber: 2
  }))

  // Event 3: Fullscreen exit 1
  ws.send(JSON.stringify({
    eventId: 'evt_3',
    type: 'FULLSCREEN_EXITED',
    clientTimestamp: new Date().toISOString(),
    sequenceNumber: 3
  }))

  // Event 4: Fullscreen exit 2
  ws.send(JSON.stringify({
    eventId: 'evt_4',
    type: 'FULLSCREEN_EXITED',
    clientTimestamp: new Date().toISOString(),
    sequenceNumber: 4
  }))

  // Event 5: Fullscreen exit 3 (triggers repeated exit rule!)
  ws.send(JSON.stringify({
    eventId: 'evt_5',
    type: 'FULLSCREEN_EXITED',
    clientTimestamp: new Date().toISOString(),
    sequenceNumber: 5
  }))

  // Wait for worker processing to finish (BullMQ and Redis roundtrips)
  console.log('[test] Waiting 3 seconds for BullMQ worker to consume jobs...')
  await sleep(3000)

  // 9. Verify PostgreSQL session state, counters, risk score
  console.log('[test] Verifying database metrics...')
  const updatedSession = await sessionService.getSessionById(session.id)
  console.log('[test] Updated Session Counters & Risk:', {
    status: updatedSession.status,
    tabSwitchCount: updatedSession.tabSwitchCount,
    fullscreenExitCount: updatedSession.fullscreenExitCount,
    riskScore: updatedSession.riskScore,
    riskLevel: updatedSession.riskLevel
  })

  // Assert counters
  if (updatedSession.tabSwitchCount !== 1) {
    throw new Error(`Expected tabSwitchCount=1, got ${updatedSession.tabSwitchCount}`)
  }
  if (updatedSession.fullscreenExitCount !== 3) {
    throw new Error(`Expected fullscreenExitCount=3, got ${updatedSession.fullscreenExitCount}`)
  }

  // Expected Risk score:
  // Tab Hidden (5) + 3 * Fullscreen Exited (24) + 2 extra Exits (10) = 39.
  // 39 should be MEDIUM risk level.
  if (updatedSession.riskScore !== 39) {
    throw new Error(`Expected riskScore=39, got ${updatedSession.riskScore}`)
  }
  if (updatedSession.riskLevel !== 'MEDIUM') {
    throw new Error(`Expected riskLevel=MEDIUM, got ${updatedSession.riskLevel}`)
  }
  console.log('✓ Counters and Risk Score assertion PASSED!')

  // 10. Verify incident was triggered
  const incidents = await incidentService.getIncidentsBySessionId(session.id)
  console.log('[test] Incidents triggered:', incidents.length)
  if (incidents.length === 0) {
    throw new Error('Expected at least 1 incident to be generated')
  }

  const repeatedFullscreenIncident = incidents.find((i) => i.type === 'FULLSCREEN_REPEATED')
  if (!repeatedFullscreenIncident) {
    throw new Error('Expected FULLSCREEN_REPEATED incident type to be created')
  }
  console.log('✓ Incident creation assertion PASSED!')

  // 11. Test teacher review API
  console.log('[test] Creating teacher review on incident...')
  const review = await reviewService.createReview({
    incidentId: repeatedFullscreenIncident.id,
    teacherId: '99999999-9999-9999-9999-999999999999',
    decision: 'NO_ISSUE',
    comment: 'False alarm. Candidate accidentally exited.'
  })

  console.log('[test] Review recorded:', review)

  // Verify incident status has changed to REVIEWED
  const reviewedIncident = await incidentService.getIncidentById(repeatedFullscreenIncident.id)
  if (reviewedIncident.status !== 'REVIEWED') {
    throw new Error(`Expected status to be REVIEWED, got ${reviewedIncident.status}`)
  }
  console.log('✓ Incident review transaction assertion PASSED!')

  // Close connection
  ws.close()
  await new Promise((resolve) => server.close(resolve))
  await eventWorker.close()
  await workerRedis.quit()
  await eventService.redisConnection.quit()
  await db.pool.end()
  console.log('[test] Server, database pool, and workers stopped successfully.')
  console.log('--- ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ---')
}

if (require.main === module) {
  runTests()
    .then(() => {
      process.exit(0)
    })
    .catch((err) => {
      console.error('[test-runner] TEST RUNNER FAILED:', err)
      process.exit(1)
    })
}
