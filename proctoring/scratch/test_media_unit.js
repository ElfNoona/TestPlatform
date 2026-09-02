'use strict'

const db = require('../src/db')
const migrate = require('../src/db/migrate')
const mediaService = require('../src/services/media.service')
const sessionService = require('../src/services/session.service')
const { MEDIA_STATES, MEDIA_TYPES } = require('../src/config/constants')

async function runUnitTests() {
  console.log('=== RUNNING MEDIA UNIT TESTS ===')

  // 1. Setup DB
  await migrate()

  console.log('[unit-test] Cleaning test database tables...')
  await db.query('DELETE FROM proctoring_reviews')
  await db.query('DELETE FROM proctoring_incidents')
  await db.query('DELETE FROM proctoring_events')
  await db.query('DELETE FROM proctoring_media')
  await db.query('DELETE FROM proctoring_sessions')
  await db.query('DELETE FROM answers')
  await db.query('DELETE FROM attempts')
  await db.query('DELETE FROM students')

  // 2. Seed student and session
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

  const session = await sessionService.createSession({
    assessmentSessionId: attemptId,
    candidateId: studentId,
    assessmentId
  })

  // 3. Test requestUploadUrl
  console.log('[unit-test] Testing media service requestUploadUrl...')
  const payload = {
    sessionId: session.id,
    mediaType: MEDIA_TYPES.WEBCAM_SNAPSHOT,
    mimeType: 'image/jpeg',
    sizeBytes: 150000,
    capturedAt: new Date().toISOString()
  }

  const uploadResult = await mediaService.requestUploadUrl(payload)
  console.log('[unit-test] uploadResult keys:', Object.keys(uploadResult))

  if (!uploadResult.mediaId || !uploadResult.uploadUrl || !uploadResult.storageKey) {
    throw new Error('requestUploadUrl failed to return core fields')
  }

  // Assert storage key namespace
  const expectedPrefix = `sessions/${session.id}/`
  if (!uploadResult.storageKey.startsWith(expectedPrefix)) {
    throw new Error(`Expected storage key to start with ${expectedPrefix}, got ${uploadResult.storageKey}`)
  }

  // Verify DB record status
  const dbMediaRes = await db.query('SELECT * FROM proctoring_media WHERE id = $1', [uploadResult.mediaId])
  if (dbMediaRes.rows.length === 0) {
    throw new Error('Media record was not inserted in database')
  }
  const dbMedia = dbMediaRes.rows[0]
  if (dbMedia.status !== MEDIA_STATES.REQUESTED) {
    throw new Error(`Expected status REQUESTED, got ${dbMedia.status}`)
  }
  console.log('✓ requestUploadUrl verified in DB')

  // 4. Test Local Storage adapter functions directly
  console.log('[unit-test] Testing storage adapter directly...')
  const dummyBuffer = Buffer.from('dummy-jpeg-data')
  const savedPath = await mediaService.storageAdapter.saveBuffer(uploadResult.storageKey, dummyBuffer)
  console.log('[unit-test] Saved dummy file to path:', savedPath)

  const exists = await mediaService.storageAdapter.objectExists(uploadResult.storageKey)
  if (!exists) {
    throw new Error('Direct saveBuffer did not write file successfully')
  }

  const readBuffer = await mediaService.storageAdapter.getBuffer(uploadResult.storageKey)
  if (readBuffer.toString() !== 'dummy-jpeg-data') {
    throw new Error('Buffer read mismatch')
  }
  console.log('✓ Storage adapter save and read verified')

  // 5. Test completeUpload
  console.log('[unit-test] Testing media service completeUpload...')
  const completedRecord = await mediaService.completeUpload(uploadResult.mediaId, 150000)
  if (completedRecord.status !== MEDIA_STATES.VERIFIED) {
    throw new Error(`Expected status VERIFIED, got ${completedRecord.status}`)
  }
  console.log('✓ completeUpload updated status to VERIFIED')

  // 6. Test deleteObject
  await mediaService.storageAdapter.deleteObject(uploadResult.storageKey)
  const stillExists = await mediaService.storageAdapter.objectExists(uploadResult.storageKey)
  if (stillExists) {
    throw new Error('deleteObject failed to delete file')
  }
  console.log('✓ deleteObject verified')

  await db.pool.end()
  console.log('=== ALL MEDIA UNIT TESTS PASSED ===')
}

if (require.main === module) {
  runUnitTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[unit-test-runner] FAILED:', err)
      process.exit(1)
    })
}
