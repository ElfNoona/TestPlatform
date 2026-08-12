'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
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
const { Queue } = require('bullmq')

const TEST_PORT = 7992
const jwtSecret = env.JWT_SECRET

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const args = process.argv.slice(2)
const durationArg = args.find(a => a.startsWith('--duration='))
const durationSeconds = durationArg ? parseInt(durationArg.split('=')[1], 10) : 30 // default 30s for rapid test, set 1800-3600 for long soak
const intervalMs = durationSeconds > 120 ? 60000 : 10000 // log every minute for long soak, 10s for short tests

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

// Global counters for metrics report
const stats = {
  generated: 0,
  accepted: 0,
  acked: 0,
  persisted: 0,
  late: 0,
  rejected: 0,
  rate_limited: 0,
  failed: 0,
  lost: 0,
  duplicated: 0
}

const generatedEventsLog = []

async function runSoakTest() {
  console.log(`--- STARTING PROCTORING ${durationSeconds}s SOAK TEST ---`)
  console.log(`[soak] Metric logging interval: ${intervalMs / 1000}s`)

  const { eventWorker, redisConnection: workerRedis } = require('../src/workers/event.worker')
  const q = new Queue('proctoring-events', { connection: workerRedis })

  await migrate()
  await cleanDB()

  const numCandidates = 10 // scale down for local simulation
  const sessionIds = []
  const tokens = []
  const studentIds = []
  const attemptIds = []
  const assessmentId = '00000000-0000-0000-0000-000000009999'

  // Seed candidates
  for (let i = 0; i < numCandidates; i++) {
    const studentId = `00000000-0000-0000-9999-${i.toString().padStart(12, '0')}`
    const attemptId = `00000000-0000-0000-8888-${i.toString().padStart(12, '0')}`

    await db.query(
      `INSERT INTO students (id, name, access_code, question_set_id)
       VALUES ($1, $2, $3, $4)`,
      [studentId, `Soak Student ${i}`, `SOAK${i.toString().padStart(3, '0')}`, assessmentId]
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

    studentIds.push(studentId)
    attemptIds.push(attemptId)
    sessionIds.push(session.id)
    tokens.push(jwt.sign({ studentId, attemptId }, jwtSecret))
  }

  // Start HTTP + WS Server
  const server = http.createServer(app)
  const wss = initWebSocket(server)
  await new Promise((resolve) => server.listen(TEST_PORT, resolve))
  console.log(`[soak] Server running on port :${TEST_PORT}`)

  const sockets = []
  const clientSequences = new Array(numCandidates).fill(1)
  const clientStates = new Array(numCandidates).fill('ACTIVE') // ACTIVE or ENDED
  const clientEndedTimes = new Array(numCandidates).fill(null)
  
  // Establish WS connections
  for (let i = 0; i < numCandidates; i++) {
    const wsUrl = `ws://localhost:${TEST_PORT}/ws/proctoring/${sessionIds[i]}?token=${tokens[i]}`
    const ws = new WebSocket(wsUrl)
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.event === 'ACK') {
        stats.acked++
        if (msg.duplicate) stats.duplicated++
      } else if (msg.event === 'ERROR') {
        if (msg.code === 'RATE_LIMITED') {
          stats.rate_limited++
        } else {
          stats.failed++
        }
      }
    })

    await new Promise((resolve) => ws.on('open', resolve))
    sockets.push(ws)
  }

  const metricsHistory = []
  let isRunning = true

  // 1. Metric collector loop
  const collectorInterval = setInterval(async () => {
    if (!isRunning) return
    
    const mem = process.memoryUsage()
    const waitingJobs = await q.getWaitingCount()
    const activeJobs = await q.getActiveCount()
    const completedJobs = await q.getCompletedCount()
    const failedJobs = await q.getFailedCount()

    const poolTotal = db.pool.totalCount
    const poolIdle = db.pool.idleCount
    const poolWaiting = db.pool.waitingCount

    const metricRecord = {
      timestamp: new Date().toISOString(),
      websocketConnections: wss.clients.size,
      queue: {
        waiting: waitingJobs,
        active: activeJobs,
        completed: completedJobs,
        failed: failedJobs
      },
      postgres: {
        poolTotal,
        poolIdle,
        poolWaiting
      },
      process: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024)
      },
      stats: { ...stats }
    }
    
    metricsHistory.push(metricRecord)
    console.log(`[soak-metric] Sockets: ${metricRecord.websocketConnections} | Heap: ${metricRecord.process.heapUsedMb}MB | Queue depth: ${waitingJobs}`)
  }, intervalMs)

  // Helper to generate a random event
  const sendRandomEvent = (idx) => {
    if (idx < 0 || idx >= numCandidates) return
    const ws = sockets[idx]
    if (ws.readyState !== WebSocket.OPEN) return

    const types = ['TAB_HIDDEN', 'COPY', 'PASTE']
    const type = types[Math.floor(Math.random() * types.length)]
    const clientEventId = `evt_soak_${idx}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    
    const eventPayload = {
      clientEventId,
      type,
      clientTimestamp: new Date().toISOString(),
      sequenceNumber: clientSequences[idx]++
    }

    ws.send(JSON.stringify(eventPayload))
    stats.generated++

    generatedEventsLog.push({
      sessionId: sessionIds[idx],
      clientEventId,
      type,
      sequenceNumber: eventPayload.sequenceNumber,
      sentAt: new Date(),
      sessionStatusAtSend: clientStates[idx]
    })
  }

  // 2. Event generator loop
  const generatorInterval = setInterval(() => {
    if (!isRunning) return
    // Pick random candidate and send random event
    const randomIdx = Math.floor(Math.random() * numCandidates)
    sendRandomEvent(randomIdx)
  }, 300) // 300ms delay yields ~3 events/second aggregate

  // 3. Simulated exam end loop (reconcile ended states)
  const finalizerInterval = setInterval(async () => {
    if (!isRunning) return
    // Pick active candidate and end their session
    const activeIndices = []
    for (let i = 0; i < numCandidates; i++) {
      if (clientStates[i] === 'ACTIVE') activeIndices.push(i)
    }
    if (activeIndices.length === 0) return

    const pickIdx = activeIndices[Math.floor(Math.random() * activeIndices.length)]
    clientStates[pickIdx] = 'ENDED'
    clientEndedTimes[pickIdx] = new Date()

    console.log(`[soak] Finalizing session for student ${pickIdx} via http end endpoint...`)
    try {
      await sessionService.endSession(sessionIds[pickIdx])
    } catch (err) {
      console.error(`[soak-error] Failed to finalize session ${sessionIds[pickIdx]}:`, err.message)
    }
  }, Math.max(5000, Math.round(durationSeconds * 1000 / numCandidates)))

  // Run the soak test for the configured duration
  await sleep(durationSeconds * 1000)

  console.log('\n[soak] Stopping new traffic and finalizing remaining active sessions...')
  isRunning = false
  clearInterval(generatorInterval)
  clearInterval(finalizerInterval)

  // End any remaining active sessions
  for (let i = 0; i < numCandidates; i++) {
    if (clientStates[i] === 'ACTIVE') {
      clientStates[i] = 'ENDED'
      clientEndedTimes[i] = new Date()
      await sessionService.endSession(sessionIds[i]).catch(() => {})
    }
  }

  // Let the queue drain fully
  console.log('[soak] Waiting 4 seconds for queue to drain completely...')
  await sleep(4000)
  clearInterval(collectorInterval)

  // 4. FOUR-LAYER RECONCILIATION
  console.log('\n[soak] Starting Four-Layer Reconciliation Audit...')
  const reconciliationReport = {
    passed: true,
    totalGenerated: generatedEventsLog.length,
    missing: [],
    details: {}
  }

  try {
    for (let i = 0; i < numCandidates; i++) {
      const sessionId = sessionIds[i]
      const clientEvents = generatedEventsLog.filter(e => e.sessionId === sessionId)
      
      // Fetch DB records for this session
      const dbEvents = await eventService.getEventsBySession(sessionId)
      const session = await sessionService.getSessionById(sessionId)
      
      const candidateReport = {
        passed: true,
        generated: clientEvents.length,
        persisted: dbEvents.length,
        errors: []
      }

      // Layer 1: Event Identity (unique clientEventId matched in DB)
      for (const clientEvt of clientEvents) {
        const found = dbEvents.find(e => e.clientEventId === clientEvt.clientEventId)
        if (!found) {
          candidateReport.errors.push(`Missing event ID: ${clientEvt.clientEventId}`)
          reconciliationReport.missing.push(clientEvt.clientEventId)
          candidateReport.passed = false
          reconciliationReport.passed = false
        }
      }

      // Layer 2: Event Transformation (LATE_EVENT transformation)
      for (const dbEvt of dbEvents) {
        const clientEvt = clientEvents.find(e => e.clientEventId === dbEvt.clientEventId)
        if (!clientEvt) continue

        if (clientEvt.sessionStatusAtSend === 'ENDED') {
          if (dbEvt.type !== 'LATE_EVENT') {
            candidateReport.errors.push(`Event ${dbEvt.clientEventId} sent after end should be LATE_EVENT, but got ${dbEvt.type}`)
            candidateReport.passed = false
            reconciliationReport.passed = false
          }
          if (dbEvt.metadata.originalType !== clientEvt.type) {
            candidateReport.errors.push(`LATE_EVENT ${dbEvt.clientEventId} metadata.originalType should be ${clientEvt.type}, got ${dbEvt.metadata.originalType}`)
            candidateReport.passed = false
            reconciliationReport.passed = false
          }
        } else {
          if (dbEvt.type !== clientEvt.type) {
            candidateReport.errors.push(`Event ${dbEvt.clientEventId} type mismatch. Client: ${clientEvt.type}, DB: ${dbEvt.type}`)
            candidateReport.passed = false
            reconciliationReport.passed = false
          }
        }
      }

      // Layer 3: Counters (TAB_HIDDEN count === tab_switch_count, etc.)
      const expectedTabSwitches = dbEvents.filter(e => e.type === 'TAB_HIDDEN').length
      const expectedCopies = dbEvents.filter(e => e.type === 'COPY').length
      const expectedPastes = dbEvents.filter(e => e.type === 'PASTE').length

      if (session.tabSwitchCount !== expectedTabSwitches) {
        candidateReport.errors.push(`Tab switch counter mismatch. DB: ${session.tabSwitchCount}, Expected: ${expectedTabSwitches}`)
        candidateReport.passed = false
        reconciliationReport.passed = false
      }
      if (session.copyCount !== expectedCopies) {
        candidateReport.errors.push(`Copy counter mismatch. DB: ${session.copyCount}, Expected: ${expectedCopies}`)
        candidateReport.passed = false
        reconciliationReport.passed = false
      }
      if (session.pasteCount !== expectedPastes) {
        candidateReport.errors.push(`Paste counter mismatch. DB: ${session.pasteCount}, Expected: ${expectedPastes}`)
        candidateReport.passed = false
        reconciliationReport.passed = false
      }

      // Layer 4: Risk (expected risk score === DB risk_score)
      const expectedRisk = expectedTabSwitches * 5 + expectedCopies * 2 + expectedPastes * 3
      if (session.riskScore !== expectedRisk) {
        candidateReport.errors.push(`Risk score mismatch. DB: ${session.riskScore}, Expected: ${expectedRisk}`)
        candidateReport.passed = false
        reconciliationReport.passed = false
      }

      reconciliationReport.details[sessionId] = candidateReport
    }

    // Freeze operations and dump diagnostics on failure
    if (!reconciliationReport.passed) {
      console.error('[soak] Mismatch detected during reconciliation! Dumping diagnostic records...')
    } else {
      console.log('✓ Four-layer reconciliation successfully completed with zero discrepancies!')
    }

  } catch (auditErr) {
    reconciliationReport.passed = false
    reconciliationReport.error = auditErr.message
    console.error('[soak-audit-fatal] Audit execution failed:', auditErr)
  }

  // 5. Write reports to scratch/
  const scratchDir = path.resolve(__dirname)
  
  fs.writeFileSync(path.join(scratchDir, 'soak_metrics.json'), JSON.stringify(metricsHistory, null, 2))
  fs.writeFileSync(path.join(scratchDir, 'soak_events.json'), JSON.stringify(generatedEventsLog, null, 2))
  fs.writeFileSync(path.join(scratchDir, 'soak_reconciliation.json'), JSON.stringify(reconciliationReport, null, 2))

  const soakSummary = {
    durationSeconds,
    numCandidates,
    events: {
      generated: stats.generated,
      acked: stats.acked,
      persisted: generatedEventsLog.length - reconciliationReport.missing.length,
      lost: reconciliationReport.missing.length,
      rateLimited: stats.rate_limited
    },
    passed: reconciliationReport.passed
  }
  fs.writeFileSync(path.join(scratchDir, 'soak_summary.json'), JSON.stringify(soakSummary, null, 2))
  console.log(`[soak] Summaries written to folder: ${scratchDir}`)

  // Close all sockets
  for (const ws of sockets) {
    ws.close()
  }

  // Close servers
  server.close()
  await eventWorker.close()
  await workerRedis.quit()
  await eventService.redisConnection.quit()
  await q.close()
  await db.pool.end()

  assert.ok(reconciliationReport.passed, 'Reconciliation report must contain 0 errors')
  console.log('--- SOAK TEST RUN COMPLETED SUCCESSFULLY ---')
}

runSoakTest().catch((err) => {
  console.error('[test-runner] SOAK TEST RUN FAILED:', err)
  process.exit(1)
})
