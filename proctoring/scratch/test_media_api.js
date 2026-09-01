'use strict'

const http = require('http')
const jwt = require('jsonwebtoken')
const app = require('../src/app')
const TEST_PORT = 7998
const env = require('../src/config/env')
env.PORT = TEST_PORT
const db = require('../src/db')
const migrate = require('../src/db/migrate')
const sessionService = require('../src/services/session.service')
const mediaService = require('../src/services/media.service')
const { MEDIA_STATES, MEDIA_TYPES } = require('../src/config/constants')

const jwtSecret = env.JWT_SECRET

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runApiTests() {
  console.log('=== RUNNING MEDIA API INTEGRATION TESTS ===')

  // 1. Setup DB
  await migrate()

  console.log('[api-test] Cleaning test database tables...')
  await db.query('DELETE FROM proctoring_reviews')
  await db.query('DELETE FROM proctoring_incidents')
  await db.query('DELETE FROM proctoring_events')
  await db.query('DELETE FROM proctoring_media')
  await db.query('DELETE FROM proctoring_sessions')
  await db.query('DELETE FROM answers')
  await db.query('DELETE FROM attempts')
  await db.query('DELETE FROM students')

  // 2. Seed student and sessions
  const student1Id = '11111111-1111-1111-1111-111111111111'
  const student2Id = '55555555-5555-5555-5555-555555555555'
  const attempt1Id = '22222222-2222-2222-2222-222222222222'
  const attempt2Id = '66666666-6666-6666-6666-666666666666'
  const assessmentId = '33333333-3333-3333-3333-333333333333'

  await db.query(
    `INSERT INTO students (id, name, access_code, question_set_id)
     VALUES ($1, 'Student One', 'CODE1', $3), ($2, 'Student Two', 'CODE2', $3)`,
    [student1Id, student2Id, assessmentId]
  )

  await db.query(
    `INSERT INTO attempts (id, student_id, start_time, duration_seconds)
     VALUES ($1, $2, now(), 7200), ($3, $4, now(), 7200)`,
    [attempt1Id, student1Id, attempt2Id, student2Id]
  )

  const session1 = await sessionService.createSession({
    assessmentSessionId: attempt1Id,
    candidateId: student1Id,
    assessmentId
  })

  const session2 = await sessionService.createSession({
    assessmentSessionId: attempt2Id,
    candidateId: student2Id,
    assessmentId
  })

  // 3. Generate tokens
  const student1Token = jwt.sign({ studentId: student1Id, attemptId: attempt1Id }, jwtSecret)
  const student2Token = jwt.sign({ studentId: student2Id, attemptId: attempt2Id }, jwtSecret)
  const teacherToken = jwt.sign({ email: 'teacher@exam.org', role: 'teacher' }, jwtSecret)

  // 4. Start HTTP Server
  console.log(`[api-test] Launching test server on port :${TEST_PORT}...`)
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(TEST_PORT, resolve))

  // Helper function for HTTP requests
  async function request(options, body = null) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: 'localhost',
        port: TEST_PORT,
        ...options
      }, (res) => {
        let rawData = ''
        res.on('data', (chunk) => { rawData += chunk })
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: rawData ? JSON.parse(rawData) : null,
              rawBody: rawData
            })
          } catch (e) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: null,
              rawBody: rawData
            })
          }
        })
      })
      req.on('error', reject)
      if (body) {
        if (typeof body === 'string' || Buffer.isBuffer(body)) {
          req.write(body)
        } else {
          req.write(JSON.stringify(body))
        }
      }
      req.end()
    })
  }

  // Helper for HTTP PUT upload
  async function putRequest(urlStr, buffer) {
    const urlParsed = new URL(urlStr)
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: urlParsed.hostname,
        port: urlParsed.port,
        path: urlParsed.pathname + urlParsed.search,
        method: 'PUT',
        headers: {
          'Content-Length': buffer.length,
          'Content-Type': 'image/jpeg'
        }
      }, (res) => {
        let rawData = ''
        res.on('data', (chunk) => { rawData += chunk })
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            rawBody: rawData
          })
        })
      })
      req.on('error', reject)
      req.write(buffer)
      req.end()
    })
  }

  // --- TEST CASE 1: Authentication & Authorization Bounds ---
  console.log('[api-test] Testing auth blocks on /upload-url...')
  
  // No auth header
  let res = await request({ path: '/api/v1/media/upload-url', method: 'POST' })
  if (res.statusCode !== 401) throw new Error(`Expected 401, got ${res.statusCode}`)

  // Wrong token (student 1 requests for session 2)
  res = await request({
    path: '/api/v1/media/upload-url',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${student1Token}`,
      'Content-Type': 'application/json'
    }
  }, {
    sessionId: session2.id,
    mediaType: MEDIA_TYPES.WEBCAM_SNAPSHOT,
    mimeType: 'image/jpeg',
    sizeBytes: 50000,
    capturedAt: new Date().toISOString()
  })
  if (res.statusCode !== 403) throw new Error(`Expected 403, got ${res.statusCode}`)
  console.log('✓ Authentication & isolation guards blocking cross-talk')

  // --- TEST CASE 2: Request Upload URL ---
  console.log('[api-test] Testing upload URL generation...')
  res = await request({
    path: '/api/v1/media/upload-url',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${student1Token}`,
      'Content-Type': 'application/json'
    }
  }, {
    sessionId: session1.id,
    mediaType: MEDIA_TYPES.WEBCAM_SNAPSHOT,
    mimeType: 'image/jpeg',
    sizeBytes: 50000,
    capturedAt: new Date().toISOString()
  })
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`)
  
  const uploadData = res.body
  if (!uploadData.mediaId || !uploadData.uploadUrl || !uploadData.storageKey) {
    throw new Error('Upload URL payload structure invalid')
  }
  console.log('✓ Upload URL payload successfully returned')

  // --- TEST CASE 3: Direct HTTP PUT File Upload ---
  console.log('[api-test] Testing direct file upload simulation...')
  const dummyBuffer = Buffer.from('mock-jpeg-binary-data-payload')
  const uploadRes = await putRequest(uploadData.uploadUrl, dummyBuffer)
  if (uploadRes.statusCode !== 200) {
    throw new Error(`Direct PUT upload failed with status ${uploadRes.statusCode}`)
  }
  console.log('✓ File uploaded successfully to simulated local bucket')

  // --- TEST CASE 4: Complete Upload Verification ---
  console.log('[api-test] Testing upload completion...')
  res = await request({
    path: `/api/v1/media/${uploadData.mediaId}/complete`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${student1Token}`,
      'Content-Type': 'application/json'
    }
  }, {
    sizeBytes: dummyBuffer.length
  })
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`)
  if (res.body.status !== MEDIA_STATES.VERIFIED) {
    throw new Error(`Expected status VERIFIED, got ${res.body.status}`)
  }
  console.log('✓ Upload verified and updated in database')

  // --- TEST CASE 5: Teacher Get Download URL & Auditing ---
  console.log('[api-test] Testing teacher download URL retrieval...')
  res = await request({
    path: `/api/v1/media/${uploadData.mediaId}/url`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${teacherToken}`
    }
  })
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`)
  if (!res.body.downloadUrl || !res.body.downloadUrl.includes('local-download')) {
    throw new Error('Download URL structure invalid')
  }
  console.log('✓ Teacher retrieved download URL')

  // Check audit log output was printed by testing endpoint directly

  // --- TEST CASE 6: Teacher List Session Media ---
  console.log('[api-test] Testing session media timeline listing...')
  res = await request({
    path: `/api/v1/sessions/${session1.id}/media`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${teacherToken}`
    }
  })
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`)
  if (res.body.media.length !== 1 || res.body.media[0].id !== uploadData.mediaId) {
    throw new Error('Session media list invalid')
  }
  console.log('✓ Session media list timeline retrieval verified')

  // --- TEST CASE 7: Retention Policy / Cleanup Worker ---
  console.log('[api-test] Testing automatic expired media cleanup...')
  // Insert an already-expired record directly
  const expiredId = '77777777-7777-7777-7777-777777777777'
  const expiredKey = `sessions/${session1.id}/${expiredId}.jpg`
  
  await db.query(`
    INSERT INTO proctoring_media (
      id, proctoring_session_id, media_type, status,
      storage_provider, storage_key, mime_type, captured_at, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, now() - INTERVAL '31 days', now() - INTERVAL '1 day')
  `, [expiredId, session1.id, MEDIA_TYPES.WEBCAM_SNAPSHOT, MEDIA_STATES.VERIFIED, env.MEDIA_STORAGE_PROVIDER, expiredKey, 'image/jpeg'])

  // Write file locally
  await mediaService.storageAdapter.saveBuffer(expiredKey, Buffer.from('expired-data'))
  
  // Verify file exists
  let expiredExists = await mediaService.storageAdapter.objectExists(expiredKey)
  if (!expiredExists) throw new Error('Expired file not written')

  // Run cleanup service directly
  const deletedCount = await mediaService.cleanupExpiredMedia()
  if (deletedCount === 0) throw new Error('Cleanup did not identify expired media')

  // Verify file was deleted from storage
  expiredExists = await mediaService.storageAdapter.objectExists(expiredKey)
  if (expiredExists) throw new Error('Expired file still exists on storage')

  // Verify DB record status was updated to DELETED
  const checkExpiredRes = await db.query('SELECT status FROM proctoring_media WHERE id = $1', [expiredId])
  if (checkExpiredRes.rows[0].status !== MEDIA_STATES.DELETED) {
    throw new Error(`Expected status DELETED, got ${checkExpiredRes.rows[0].status}`)
  }
  console.log('✓ Expired media correctly cleaned up from storage and marked in DB')

  // Close server
  await new Promise((resolve) => server.close(resolve))
  await db.pool.end()
  console.log('=== ALL MEDIA API INTEGRATION TESTS PASSED ===')
}

if (require.main === module) {
  runApiTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[api-test-runner] FAILED:', err)
      process.exit(1)
    })
}
