'use strict'

const http = require('http')
const assert = require('assert')
const jwt = require('jsonwebtoken')
const WebSocket = require('ws')
const { execSync } = require('child_process')
const app = require('../src/app')
const env = require('../src/config/env')
const db = require('../src/db')
const migrate = require('../src/db/migrate')
const sessionService = require('../src/services/session.service')
const eventService = require('../src/services/event.service')
const riskService = require('../src/services/risk.service')
const { initWebSocket } = require('../src/websocket')
const { Worker } = require('bullmq')

const TEST_PORT = 7997
const jwtSecret = env.JWT_SECRET

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runDockerCmd(cmd) {
  try {
    console.log(`[docker] running: ${cmd}`)
    execSync(cmd, { stdio: 'inherit' })
  } catch (err) {
    console.error(`[docker-error] failed running ${cmd}:`, err.message)
  }
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
     VALUES ($1, 'Failure Student', 'FAILACCESS', $2)`,
    [studentId, assessmentId]
  )
  await db.query(
    `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
     VALUES ($1, $2, now(), 7200)`,
     [attemptId, studentId]
  )
}

async function runTests() {
  console.log('--- STARTING PROCTORING FAILURE RECOVERY TESTS ---')

  // Import worker to register the global consumer
  const { eventWorker, redisConnection: workerRedis, processEventJob } = require('../src/workers/event.worker')

  await migrate()
  await cleanDB()

  const studentId = 'ff111111-1111-1111-1111-111111111111'
  const attemptId = 'ff222222-2222-2222-2222-222222222222'
  const assessmentId = 'ff333333-3333-3333-3333-333333333333'
  await seedData(studentId, attemptId, assessmentId)

  // Start HTTP + WebSocket Server
  let server = http.createServer(app)
  let wss = initWebSocket(server)
  await new Promise((resolve) => server.listen(TEST_PORT, resolve))
  console.log(`[test] Server running on port :${TEST_PORT}`)

  const studentToken = jwt.sign({ studentId, attemptId }, jwtSecret)

  try {
    // ── TEST 1: Redis Failure & Client Buffering / Degraded response ─────────────
    console.log('\n[TEST 1] Testing Redis Failure Recovery...')
    const session = await sessionService.createSession({
      assessmentSessionId: attemptId,
      candidateId: studentId,
      assessmentId
    })

    const wsUrl = `ws://localhost:${TEST_PORT}/ws/proctoring/${session.id}?token=${studentToken}`
    const wsA = new WebSocket(wsUrl)
    
    let responsesA = []
    let onConnectedA
    const connectedPromiseA = new Promise((resolve) => {
      onConnectedA = resolve
    })

    wsA.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      responsesA.push(msg)
      if (msg.event === 'CONNECTED') onConnectedA()
    })

    await connectedPromiseA
    console.log('[test] Connected to socket A.')

    // Stop Redis container to simulate outage
    runDockerCmd('docker stop flutter_test_platform-redis-1')
    await sleep(2000)

    // Send event while Redis is down
    console.log('[test] Sending event while Redis is down...')
    wsA.send(JSON.stringify({
      clientEventId: 'evt_fail_redis',
      type: 'TAB_HIDDEN',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: 1
    }))

    await sleep(1000)
    
    // Verify server responded with PROCTORING_DEGRADED error and didn't crash
    const degradedResponse = responsesA.find(r => r.event === 'ERROR' && r.code === 'PROCTORING_DEGRADED')
    assert.ok(degradedResponse, 'Server must return PROCTORING_DEGRADED code')
    console.log('✓ Degraded error returned on Redis outage.')

    // Recover Redis container
    runDockerCmd('docker start flutter_test_platform-redis-1')
    await sleep(4000) // wait for Redis to accept connections

    // Send event again (re-transmission / retry flush)
    console.log('[test] Re-sending event after Redis recovered...')
    wsA.send(JSON.stringify({
      clientEventId: 'evt_fail_redis',
      type: 'TAB_HIDDEN',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: 1
    }))

    await sleep(2000) // let worker process

    // Verify ACK is received now
    const ackResponse = responsesA.find(r => r.event === 'ACK' && r.clientEventId === 'evt_fail_redis')
    assert.ok(ackResponse, 'Server must respond with ACK after Redis returns')
    console.log('✓ ACK received after Redis recovery.')
    
    wsA.close()
    await sleep(500)

    // ── TEST 2: Worker Restart (Queue accumulation) ─────────────────────────────
    console.log('\n[TEST 2] Testing Worker Restart (Queue accumulation)...')
    
    const attemptId2 = '00000000-0000-0000-0000-000000000012'
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
    
    const wsUrl2 = `ws://localhost:${TEST_PORT}/ws/proctoring/${session2.id}?token=${jwt.sign({ studentId, attemptId: attemptId2 }, jwtSecret)}`
    const wsB = new WebSocket(wsUrl2)
    let responsesB = []
    let onConnectedB
    const connectedPromiseB = new Promise((resolve) => {
      onConnectedB = resolve
    })
    wsB.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      responsesB.push(msg)
      if (msg.event === 'CONNECTED') onConnectedB()
    })
    await connectedPromiseB

    // Close the event worker (simulate worker process crash/restart)
    console.log('[test] Stopping Event Worker...')
    await eventWorker.close()

    // Send events (should get ACKs because Redis queue is up and accepts them)
    console.log('[test] Sending events while Worker is down...')
    wsB.send(JSON.stringify({ clientEventId: 'evt_w_1', type: 'TAB_HIDDEN', clientTimestamp: new Date().toISOString(), sequenceNumber: 1 }))
    wsB.send(JSON.stringify({ clientEventId: 'evt_w_2', type: 'TAB_HIDDEN', clientTimestamp: new Date().toISOString(), sequenceNumber: 2 }))
    wsB.send(JSON.stringify({ clientEventId: 'evt_w_3', type: 'TAB_HIDDEN', clientTimestamp: new Date().toISOString(), sequenceNumber: 3 }))

    await sleep(1000)
    // Check client received ACKs
    const acksB = responsesB.filter(r => r.event === 'ACK')
    assert.strictEqual(acksB.length, 3, 'Client should receive all 3 ACKs from Redis queue acceptance')

    // Verify events are NOT yet in the database (since worker is down)
    const eventsBeforeWorker = await eventService.getEventsBySession(session2.id)
    assert.strictEqual(eventsBeforeWorker.length, 0, 'No events should be persisted yet')
    console.log('✓ Queue accepted events while worker was down.')

    // Start a new worker instance to drain the queue
    console.log('[test] Restarting Event Worker to drain queue...')
    const eventWorker2 = new Worker('proctoring-events', processEventJob, {
      connection: workerRedis,
      concurrency: 5
    })

    await sleep(3000) // let worker drain queue

    // Verify events are now persisted and counters updated
    const eventsAfterWorker = await eventService.getEventsBySession(session2.id)
    assert.strictEqual(eventsAfterWorker.length, 3, 'All 3 events must be persisted now')
    const finalSession2 = await sessionService.getSessionById(session2.id)
    assert.strictEqual(finalSession2.tabSwitchCount, 3, 'Counters must be updated by restarted worker')
    console.log('✓ Worker successfully recovered and drained the queue.')
    
    wsB.close()
    await eventWorker2.close()
    await sleep(500)

    // ── TEST 3: PostgreSQL Failure & Queue Retry ───────────────────────────────
    console.log('\n[TEST 3] Testing PostgreSQL Failure & Queue Retry...')
    // Recreate/restart eventWorker
    const eventWorker3 = new Worker('proctoring-events', processEventJob, {
      connection: workerRedis,
      concurrency: 5
    })

    const attemptId3 = '00000000-0000-0000-0000-000000000013'
    await db.query(
      `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
       VALUES ($1, $2, now(), 7200)`,
       [attemptId3, studentId]
    )
    const session3 = await sessionService.createSession({
      assessmentSessionId: attemptId3,
      candidateId: studentId,
      assessmentId
    })

    const wsUrl3 = `ws://localhost:${TEST_PORT}/ws/proctoring/${session3.id}?token=${jwt.sign({ studentId, attemptId: attemptId3 }, jwtSecret)}`
    const wsC = new WebSocket(wsUrl3)
    let responsesC = []
    let onConnectedC
    const connectedPromiseC = new Promise((resolve) => {
      onConnectedC = resolve
    })
    wsC.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      responsesC.push(msg)
      if (msg.event === 'CONNECTED') onConnectedC()
    })
    await connectedPromiseC

    // Stop PostgreSQL container
    runDockerCmd('docker stop flutter_test_platform-postgres-1')
    await sleep(2000)

    // Send event (will be enqueued to Redis, but worker processing will fail due to PG offline)
    console.log('[test] Sending event while Postgres is down...')
    wsC.send(JSON.stringify({ clientEventId: 'evt_w_pg_fail', type: 'TAB_HIDDEN', clientTimestamp: new Date().toISOString(), sequenceNumber: 1 }))

    await sleep(1500) // worker tries to process and fails/retries

    // Start PostgreSQL container
    runDockerCmd('docker start flutter_test_platform-postgres-1')
    await sleep(6000) // wait for PG to start up and accept connections

    // Wait for BullMQ retry to execute successfully
    console.log('[test] Waiting for BullMQ queue retry to process and persist event...')
    await sleep(4000)

    // Verify event is now written to database successfully
    const pgEvents = await eventService.getEventsBySession(session3.id)
    assert.strictEqual(pgEvents.length, 1, 'Event must be successfully written after PG recovery')
    console.log('✓ PostgreSQL failure successfully resolved via queue retries!')

    wsC.close()
    await eventWorker3.close()
    await sleep(500)

  } finally {
    // Shutdown
    server.close()
    await eventWorker.close()
    await workerRedis.quit()
    await eventService.redisConnection.quit()
    await db.pool.end()
  }

  console.log('\n--- ALL PROCTORING FAILURE RECOVERY TESTS PASSED! ---')
}

runTests().catch((err) => {
  console.error('[test-runner] FAILURE RECOVERY TESTS FAILED:', err)
  process.exit(1)
})
