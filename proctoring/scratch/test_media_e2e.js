'use strict'

const http = require('http')
const path = require('path')
const assert = require('assert')
const jwt = require('jsonwebtoken')
const puppeteer = require('puppeteer')
const app = require('../src/app')
const TEST_PORT = 7993
const env = require('../src/config/env')
env.PORT = TEST_PORT
const db = require('../src/db')
const migrate = require('../src/db/migrate')
const sessionService = require('../src/services/session.service')
const mediaService = require('../src/services/media.service')
const { MEDIA_STATES } = require('../src/config/constants')

const jwtSecret = env.JWT_SECRET

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runE2eTests() {
  console.log('--- STARTING PROCTORING MEDIA BROWSER E2E PUPPETEER TESTS ---')

  await migrate()

  console.log('[e2e-test] Cleaning database tables...')
  await db.query('DELETE FROM proctoring_reviews')
  await db.query('DELETE FROM proctoring_media')
  await db.query('DELETE FROM proctoring_incidents')
  await db.query('DELETE FROM proctoring_events')
  await db.query('DELETE FROM proctoring_sessions')
  await db.query('DELETE FROM answers')
  await db.query('DELETE FROM attempts')
  await db.query('DELETE FROM students')

  const studentId = '00000000-0000-0000-0000-000000000404'
  const attemptId = '00000000-0000-0000-0000-000000000505'
  const assessmentId = '00000000-0000-0000-0000-000000000606'

  // Seed student and attempt
  await db.query(
    `INSERT INTO students (id, name, access_code, question_set_id)
     VALUES ($1, 'Puppeteer E2E Student', 'PUPE2EACCESS', $2)`,
    [studentId, assessmentId]
  )
  await db.query(
    `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
     VALUES ($1, $2, now(), 7200)`,
     [attemptId, studentId]
  )

  // Start HTTP Server
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(TEST_PORT, resolve))
  console.log(`[e2e-test] Server running on port :${TEST_PORT}`)

  const token = jwt.sign({ studentId, attemptId }, jwtSecret)

  const session = await sessionService.createSession({
    assessmentSessionId: attemptId,
    candidateId: studentId,
    assessmentId
  })

  // Launch Puppeteer with fake camera options
  console.log('[e2e-test] Launching headless browser with fake camera device flags...')
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  })

  try {
    const page = await browser.newPage()

    // Capture console output from the browser page
    page.on('console', (msg) => {
      console.log('[e2e-browser-console]', msg.text())
    })

    const mockPagePath = path.resolve(__dirname, 'mock_exam.html').replace(/\\/g, '/')
    const targetUrl = `file:///${mockPagePath}?token=${token}&sessionId=${session.id}&port=${TEST_PORT}`
    
    console.log(`[e2e-test] Navigating browser to: ${targetUrl}`)
    await page.goto(targetUrl)

    await sleep(1000)

    console.log('[e2e-test] Triggering camera capture and upload inside page...')
    const uploadResult = await page.evaluate(async (token, sessionId, port) => {
      try {
        console.log('[page] Obtaining webcam video stream...')
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        
        // Create offscreen video element to run the stream
        const video = document.createElement('video')
        video.srcObject = stream
        video.setAttribute('autoplay', '')
        video.setAttribute('muted', '')
        video.setAttribute('playsinline', '')
        document.body.appendChild(video)
        
        await new Promise((resolve) => {
          video.onloadedmetadata = () => {
            video.play().then(resolve)
          }
        })

        // Draw offscreen frame to canvas
        const canvas = document.createElement('canvas')
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, 640, 480)

        // Stop stream tracks
        stream.getTracks().forEach((track) => track.stop())
        video.remove()

        // Compress canvas frame to JPEG blob
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75))
        console.log(`[page] JPEG compressed blob size: ${blob.size} bytes`)

        // Request upload URL
        console.log('[page] Requesting upload URL...')
        const requestRes = await fetch(`http://localhost:${port}/api/v1/media/upload-url`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sessionId,
            mediaType: 'WEBCAM_SNAPSHOT',
            mimeType: 'image/jpeg',
            sizeBytes: blob.size,
            capturedAt: new Date().toISOString()
          })
        })

        if (requestRes.status !== 200) {
          throw new Error(`Upload URL request failed with status: ${requestRes.status}`)
        }

        const uploadData = await requestRes.json()
        console.log('[page] Upload authorization received. Performing direct PUT upload...')

        // PUT blob to uploadUrl
        const putRes = await fetch(uploadData.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'image/jpeg'
          },
          body: blob
        })

        if (putRes.status !== 200) {
          throw new Error(`PUT upload failed with status: ${putRes.status}`)
        }

        console.log('[page] PUT upload complete. Sending completion notice...')

        // Complete upload
        const completeRes = await fetch(`http://localhost:${port}/api/v1/media/${uploadData.mediaId}/complete`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sizeBytes: blob.size
          })
        })

        if (completeRes.status !== 200) {
          throw new Error(`Completion request failed with status: ${completeRes.status}`)
        }

        const finalizedMedia = await completeRes.json()
        return { success: true, mediaId: uploadData.mediaId, finalizedMedia }
      } catch (err) {
        console.error('[page] E2E capture failure:', err.message)
        return { success: false, error: err.message }
      }
    }, token, session.id, TEST_PORT)

    console.log('[e2e-test] Upload evaluation result:', uploadResult)
    assert.ok(uploadResult.success, `Page script failed: ${uploadResult.error}`)

    // 5. Verify database state
    console.log('[e2e-test] Verifying media database state...')
    const dbMediaRes = await db.query('SELECT * FROM proctoring_media WHERE id = $1', [uploadResult.mediaId])
    assert.strictEqual(dbMediaRes.rows.length, 1, 'Media record should exist in database')
    
    const dbMedia = dbMediaRes.rows[0]
    assert.strictEqual(dbMedia.status, MEDIA_STATES.VERIFIED, 'Media status should be VERIFIED')
    assert.ok(dbMedia.size_bytes > 0, 'Media size_bytes should be recorded')

    // Verify object exists in storage
    const exists = await mediaService.storageAdapter.objectExists(dbMedia.storage_key)
    assert.ok(exists, 'Uploaded file should exist in storage')

    console.log('✓ E2E camera capture, upload, and verification succeeded!')

  } finally {
    await browser.close()
    server.close()
    await db.pool.end()
  }

  console.log('\n--- ALL MEDIA BROWSER E2E TESTS PASSED! ---')
}

if (require.main === module) {
  runE2eTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[e2e-test-runner] FAILED:', err)
      process.exit(1)
    })
}
