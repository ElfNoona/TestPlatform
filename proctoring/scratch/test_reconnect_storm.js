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

const TEST_PORT = 7993
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

async function runTests() {
  console.log('--- STARTING PROCTORING 100-USER RECONNECT STORM TESTS ---')

  const { eventWorker, redisConnection: workerRedis } = require('../src/workers/event.worker')

  await migrate()
  await cleanDB()

  const numCandidates = 100
  const candidateIds = []
  const attemptIds = []
  const sessionIds = []
  const tokens = []

  console.log('[test] Seeding 100 students and attempts...')
  for (let i = 0; i < numCandidates; i++) {
    const studentId = `00000000-0000-0000-0000-${i.toString().padStart(12, '0')}`
    const attemptId = `00000000-0000-0000-0000-${(i + numCandidates).toString().padStart(12, '0')}`
    const assessmentId = '00000000-0000-0000-0000-333333333333'

    await db.query(
      `INSERT INTO students (id, name, access_code, question_set_id)
       VALUES ($1, $2, $3, $4)`,
      [studentId, `Storm Student ${i}`, `STORM${i.toString().padStart(3, '0')}`, assessmentId]
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

  // Helper to establish 100 connections
  const connectAll = async () => {
    const clients = []
    const connectPromises = []

    for (let i = 0; i < numCandidates; i++) {
      const wsUrl = `ws://localhost:${TEST_PORT}/ws/proctoring/${sessionIds[i]}?token=${tokens[i]}`
      const ws = new WebSocket(wsUrl)
      
      const p = new Promise((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
      })
      connectPromises.push(p)
      clients.push(ws)
    }

    await Promise.all(connectPromises)
    return clients
  }

  try {
    // 1. Connect initial 100 clients
    console.log('[test] Connecting 100 initial clients...')
    let clients = await connectAll()
    console.log('✓ 100 clients connected.')

    // 2. Simulate sudden network drop by closing all of them from the client side
    console.log('[test] Simulating sudden disconnect of all 100 clients...')
    for (const ws of clients) {
      ws.terminate() // hard close
    }
    await sleep(1000)

    // 3. Trigger Reconnect Storm: All 100 reconnect concurrently
    console.log('[test] Launching 100-user Reconnect Storm (connecting all within 1.5 seconds)...')
    const stormStartTime = Date.now()
    
    // Connect again
    const reconnectedClients = []
    const reconnectPromises = []

    for (let i = 0; i < numCandidates; i++) {
      const wsUrl = `ws://localhost:${TEST_PORT}/ws/proctoring/${sessionIds[i]}?token=${tokens[i]}`
      const ws = new WebSocket(wsUrl)
      
      // Implement local client buffer and throttled queue flush
      const localBuffer = []
      let flushInterval = null

      const queueEvent = (type) => {
        localBuffer.push({
          clientEventId: `evt_storm_${i}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          type,
          clientTimestamp: new Date().toISOString(),
          sequenceNumber: 1
        })
        triggerThrottledFlush()
      }

      const triggerThrottledFlush = () => {
        if (flushInterval) return
        flushInterval = setInterval(() => {
          if (localBuffer.length === 0) {
            clearInterval(flushInterval)
            flushInterval = null
            return
          }
          if (ws.readyState === WebSocket.OPEN) {
            const nextEvent = localBuffer.shift()
            ws.send(JSON.stringify(nextEvent))
          }
        }, 200) // 200ms spacing to bypass rate limits cleanly
      }

      ws.on('open', () => {
        // Enqueue some action events to verify they are processed cleanly on reconnect
        queueEvent('TAB_HIDDEN')
      })

      const p = new Promise((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.event === 'ACK') {
            resolve()
          }
        })
        ws.on('error', () => resolve())
      })

      reconnectPromises.push(p)
      reconnectedClients.push({ ws, localBuffer, queueEvent })
    }

    await Promise.all(reconnectPromises)
    const totalStormTime = Date.now() - stormStartTime
    console.log(`✓ Reconnect storm completed in ${totalStormTime} ms. All clients reconnected and events ACKed successfully.`)

    // Sleep to allow BullMQ worker to drain and write all events to PostgreSQL
    console.log('[test] Waiting 3 seconds for BullMQ worker to drain the queue...')
    await sleep(3000)

    // Verify rate limit was NOT triggered (which would send ERROR instead of ACK)
    // and DB processed all events
    const events = await db.query('SELECT count(*)::int as count FROM proctoring_events')
    assert.strictEqual(events.rows[0].count, 100, 'Database should contain exactly 100 events, 1 per reconnected candidate')
    console.log('✓ Ingested all re-transmitted events successfully without triggering rate limits.')

    // Close all connections
    for (const c of reconnectedClients) {
      c.ws.close()
    }

  } finally {
    server.close()
    await eventWorker.close()
    await workerRedis.quit()
    await eventService.redisConnection.quit()
    await db.pool.end()
  }

  console.log('\n--- ALL RECONNECT STORM TESTS PASSED SUCCESSFULLY! ---')
}

runTests().catch((err) => {
  console.error('[test-runner] RECONNECT STORM TESTS FAILED:', err)
  process.exit(1)
})
