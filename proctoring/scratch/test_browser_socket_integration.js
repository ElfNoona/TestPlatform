'use strict'

const http = require('http')
const path = require('path')
const assert = require('assert')
const jwt = require('jsonwebtoken')
const puppeteer = require('puppeteer')
const app = require('../src/app')
const env = require('../src/config/env')
const db = require('../src/db')
const migrate = require('../src/db/migrate')
const sessionService = require('../src/services/session.service')
const eventService = require('../src/services/event.service')
const { initWebSocket } = require('../src/websocket')

const TEST_PORT = 7994
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
     VALUES ($1, 'Puppeteer Student', 'PUPACCESS', $2)`,
    [studentId, assessmentId]
  )
  await db.query(
    `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
     VALUES ($1, $2, now(), 7200)`,
     [attemptId, studentId]
  )
}

async function runTests() {
  console.log('--- STARTING PROCTORING BROWSER E2E PUPPETEER TESTS ---')

  const { eventWorker, redisConnection: workerRedis } = require('../src/workers/event.worker')

  await migrate()
  await cleanDB()

  const studentId = '00000000-0000-0000-0000-000000000404'
  const attemptId = '00000000-0000-0000-0000-000000000505'
  const assessmentId = '00000000-0000-0000-0000-000000000606'
  await seedData(studentId, attemptId, assessmentId)

  // Start HTTP + WS Server
  const server = http.createServer(app)
  const wss = initWebSocket(server)
  await new Promise((resolve) => server.listen(TEST_PORT, resolve))
  console.log(`[test] Server running on port :${TEST_PORT}`)

  const token = jwt.sign({ studentId, attemptId }, jwtSecret)

  const session = await sessionService.createSession({
    assessmentSessionId: attemptId,
    candidateId: studentId,
    assessmentId
  })

  // Launch Puppeteer Headless Browser
  console.log('[test] Launching headless browser...')
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  try {
    const page = await browser.newPage()

    // Capture console output from the browser page for diagnostics
    page.on('console', (msg) => {
      console.log('[browser-console]', msg.text())
    })

    const mockPagePath = path.resolve(__dirname, 'mock_exam.html').replace(/\\/g, '/')
    const targetUrl = `file:///${mockPagePath}?token=${token}&sessionId=${session.id}&port=${TEST_PORT}`
    
    console.log(`[test] Navigating browser to: ${targetUrl}`)
    await page.goto(targetUrl)

    // Wait for the browser script to print WS_OPEN console message
    console.log('[test] Waiting for WebSocket connection to open inside browser...')
    await sleep(2000)

    // Trigger tab/window blur event inside browser (mimicking switching tabs)
    console.log('[test] Simulating focus loss (TAB_HIDDEN)...')
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'))
    })

    await sleep(500)

    // Trigger text copying event inside browser (mimicking COPY)
    console.log('[test] Simulating text copy (COPY)...')
    await page.evaluate(() => {
      document.dispatchEvent(new Event('copy'))
    })

    // Wait for the worker queue to drain and process events
    console.log('[test] Waiting for worker database persistence...')
    await sleep(2500)

    // Verify events were persisted in PostgreSQL
    const events = await eventService.getEventsBySession(session.id)
    console.log(`[test] Persisted events in database: ${events.length}`)
    
    const tabHiddenEvent = events.find(e => e.type === 'TAB_HIDDEN')
    const copyEvent = events.find(e => e.type === 'COPY')

    assert.ok(tabHiddenEvent, 'Database should contain a TAB_HIDDEN event')
    assert.ok(copyEvent, 'Database should contain a COPY event')
    
    // Verify that session counters and risk scores are updated
    const finalSession = await sessionService.getSessionById(session.id)
    assert.strictEqual(finalSession.tabSwitchCount, 1, 'Tab switch count should be 1')
    assert.strictEqual(finalSession.copyCount, 1, 'Copy count should be 1')
    assert.strictEqual(finalSession.riskScore, 7, 'Risk score should be updated (Tab Switch=5 + Copy=2 = 7)')
    
    console.log('✓ E2E browser telemetry events processed and validated successfully!')

  } finally {
    await browser.close()
    server.close()
    await eventWorker.close()
    await workerRedis.quit()
    await eventService.redisConnection.quit()
    await db.pool.end()
  }

  console.log('\n--- ALL BROWSER E2E integration TESTS PASSED! ---')
}

runTests().catch((err) => {
  console.error('[test-runner] BROWSER E2E TESTS FAILED:', err)
  process.exit(1)
})
