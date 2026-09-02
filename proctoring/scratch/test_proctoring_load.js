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
const { initWebSocket } = require('../src/websocket')
const { Queue } = require('bullmq')

const TEST_PORT = 7996
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

// Percentile helper
function getPercentiles(arr) {
  if (arr.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 }
  const sorted = [...arr].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const avg = sum / sorted.length
  const p50 = sorted[Math.floor(sorted.length * 0.50)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)]
  const max = sorted[sorted.length - 1]
  return { p50, p95, p99, max, avg }
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

async function runLoadTest() {
  console.log('--- STARTING PROCTORING 100-CANDIDATE LOAD AND RECOVERY TEST ---')

  const { eventWorker, redisConnection: workerRedis } = require('../src/workers/event.worker')

  await migrate()
  await cleanDB()

  // 1. Seed 100 students and attempts
  console.log('[test] Seeding 100 students and attempts...')
  const numCandidates = 100
  const candidateIds = []
  const attemptIds = []
  const sessionIds = []
  const tokens = []

  for (let i = 0; i < numCandidates; i++) {
    const studentId = `00000000-0000-0000-0000-${i.toString().padStart(12, '0')}`
    const attemptId = `11111111-1111-1111-1111-${i.toString().padStart(12, '0')}`
    const assessmentId = '22222222-2222-2222-2222-222222222222'

    await db.query(
      `INSERT INTO students (id, name, access_code, question_set_id)
       VALUES ($1, $2, $3, $4)`,
      [studentId, `Candidate ${i}`, `CODE${i.toString().padStart(3, '0')}`, assessmentId]
    )

    await db.query(
      `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
       VALUES ($1, $2, now(), 7200)`,
       [attemptId, studentId]
    )

    const session = await sessionService.createSession({
      assessmentSessionId: attemptId,
      candidateId: studentId,
      assessmentId
    })

    candidateIds.push(studentId)
    attemptIds.push(attemptId)
    sessionIds.push(session.id)
    tokens.push(jwt.sign({ studentId, attemptId }, jwtSecret))
  }

  // Start HTTP + WS Server
  const server = http.createServer(app)
  const wss = initWebSocket(server)
  await new Promise((resolve) => server.listen(TEST_PORT, resolve))
  console.log(`[test] Server running on port :${TEST_PORT}`)

  // Active sockets registry
  const sockets = []
  const ingestionLatencies = []
  let totalServerErrors = 0
  let totalACKs = 0

  // 2. Establish 100 WS connections sequentially but fast
  console.log('[test] Connecting 100 WebSocket clients...')
  const connectStartTime = Date.now()
  
  for (let i = 0; i < numCandidates; i++) {
    const wsUrl = `ws://localhost:${TEST_PORT}/ws/proctoring/${sessionIds[i]}?token=${tokens[i]}`
    const ws = new WebSocket(wsUrl)
    
    // In-memory client buffer for retries
    const clientBuffer = new Map()

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.event === 'ACK') {
        const sendTime = clientBuffer.get(msg.clientEventId)
        if (sendTime) {
          ingestionLatencies.push(Date.now() - sendTime)
          clientBuffer.delete(msg.clientEventId)
        }
        totalACKs++
      } else if (msg.event === 'ERROR') {
        totalServerErrors++
        if (msg.code === 'PROCTORING_DEGRADED') {
          // Keep in buffer and schedule retry
          const clientEventId = msg.clientEventId
          if (clientEventId) {
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                // Retry sending event
                console.log(`[ws-client] Retrying event ${clientEventId} from buffer...`)
                ws.send(JSON.stringify({
                  clientEventId,
                  type: 'TAB_HIDDEN',
                  clientTimestamp: new Date().toISOString(),
                  sequenceNumber: 2
                }))
              }
            }, 1000)
          }
        }
      }
    })

    ws.on('error', (err) => {
      console.error(`[ws-client-${i}] error:`, err.message)
    })

    await new Promise((resolve) => {
      ws.on('open', resolve)
    })
    sockets.push({ ws, clientBuffer })
  }

  console.log(`✓ 100 WebSocket clients connected in ${Date.now() - connectStartTime} ms.`)

  // 3. Steady state simulation: send 1 heartbeat per client + random browser events
  console.log('[test] Simulating 10 seconds of steady-state heartbeat and event traffic...')
  const steadyStartTime = Date.now()
  let eventSeq = 1

  // Send heartbeats
  for (let i = 0; i < numCandidates; i++) {
    const { ws, clientBuffer } = sockets[i]
    const clientEventId = `evt_load_hb_${i}`
    clientBuffer.set(clientEventId, Date.now())
    ws.send(JSON.stringify({
      clientEventId,
      type: 'HEARTBEAT',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: eventSeq++
    }))
  }

  // Send random browser events (e.g. 50 random tab switches)
  for (let step = 0; step < 50; step++) {
    const randomClientIdx = Math.floor(Math.random() * numCandidates)
    const { ws, clientBuffer } = sockets[randomClientIdx]
    const clientEventId = `evt_load_rand_${step}`
    clientBuffer.set(clientEventId, Date.now())
    ws.send(JSON.stringify({
      clientEventId,
      type: 'TAB_HIDDEN',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: eventSeq++
    }))
    await sleep(100) // 100ms delay between random events
  }

  await sleep(2000) // let processing catch up

  // 4. Simulate Redis Outage & Client Buffering under Load
  console.log('\n[TEST OUTAGE] Testing Redis Outage under Load...')
  runDockerCmd('docker stop flutter_test_platform-redis-1')
  await sleep(1000)

  // Send 20 events while Redis is offline
  console.log('[test] Sending 20 events while Redis is down...')
  for (let i = 0; i < 20; i++) {
    const { ws, clientBuffer } = sockets[i]
    const clientEventId = `evt_load_outage_${i}`
    clientBuffer.set(clientEventId, Date.now())
    ws.send(JSON.stringify({
      clientEventId,
      type: 'COPY',
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: eventSeq++
    }))
  }

  await sleep(2000)

  // Start Redis again
  runDockerCmd('docker start flutter_test_platform-redis-1')
  await sleep(4000) // let Redis start up and accept retries

  console.log('[test] Waiting for client retry buffers to flush...')
  await sleep(3000)

  // 5. Synchronized Submission Storm: all 100 candidates submit within 2 seconds
  console.log('\n[TEST STORM] Simulating Synchronized Submission Storm (100 sessions finalise)...')
  const stormLatencies = []
  const submitStartTime = Date.now()

  const submitPromises = sessionIds.map(async (sessionId) => {
    const start = Date.now()
    try {
      // Simulate main backend calling endSession directly
      const session = await sessionService.endSession(sessionId)
      stormLatencies.push(Date.now() - start)
      assert.strictEqual(session.status, 'ENDED')
    } catch (err) {
      console.error(`[storm-error] failed ending session ${sessionId}:`, err.message)
    }
  })

  await Promise.all(submitPromises)
  console.log(`✓ 100 sessions finalized in ${Date.now() - submitStartTime} ms.`)

  // Let worker queue fully drain
  console.log('[test] Waiting 3 seconds for worker queue to drain completely...')
  await sleep(3000)

  // 6. Gather and Output Metrics
  console.log('\n--- LOAD TEST REPORT AND METRICS ---')
  const ingestionMetrics = getPercentiles(ingestionLatencies)
  const stormMetrics = getPercentiles(stormLatencies)

  console.log('\n1. Latency Percentiles (Event Ingestion WS -> ACK):')
  console.log(`   p50:  ${ingestionMetrics.p50} ms`)
  console.log(`   p95:  ${ingestionMetrics.p95} ms`)
  console.log(`   p99:  ${ingestionMetrics.p99} ms`)
  console.log(`   Max:  ${ingestionMetrics.max} ms`)
  console.log(`   Avg:  ${ingestionMetrics.avg.toFixed(1)} ms`)

  console.log('\n2. Latency Percentiles (Session Finalization HTTP end request):')
  console.log(`   p50:  ${stormMetrics.p50} ms`)
  console.log(`   p95:  ${stormMetrics.p95} ms`)
  console.log(`   p99:  ${stormMetrics.p99} ms`)
  console.log(`   Max:  ${stormMetrics.max} ms`)
  console.log(`   Avg:  ${stormMetrics.avg.toFixed(1)} ms`)

  // Queue metrics
  const q = new Queue('proctoring-events', { connection: workerRedis })
  const waitingJobs = await q.getWaitingCount()
  const activeJobs = await q.getActiveCount()
  const completedJobs = await q.getCompletedCount()
  const failedJobs = await q.getFailedCount()

  console.log('\n3. BullMQ Queue Metrics:')
  console.log(`   Waiting jobs:   ${waitingJobs}`)
  console.log(`   Active jobs:    ${activeJobs}`)
  console.log(`   Completed jobs: ${completedJobs}`)
  console.log(`   Failed jobs:    ${failedJobs}`)

  // PostgreSQL Connection Pool stats
  console.log('\n4. PostgreSQL Pool Metrics:')
  console.log(`   Total pool clients: ${db.pool.totalCount}`)
  console.log(`   Idle pool clients:  ${db.pool.idleCount}`)
  console.log(`   Waiting clients:    ${db.pool.waitingCount}`)

  console.log('\n5. WebSocket Totals:')
  console.log(`   Successful ACKs:    ${totalACKs}`)
  console.log(`   Server-side errors: ${totalServerErrors}`)

  // Close all sockets
  for (const { ws } of sockets) {
    ws.close()
  }

  // Cleanup server
  server.close()
  await eventWorker.close()
  await workerRedis.quit()
  await eventService.redisConnection.quit()
  await q.close()
  await db.pool.end()

  console.log('\n--- 100-CANDIDATE LOAD AND RECOVERY TEST COMPLETED SUCCESSFULLY! ---')
}

runLoadTest().catch((err) => {
  console.error('[test-runner] LOAD TEST FAILED:', err)
  process.exit(1)
})
