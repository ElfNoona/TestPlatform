'use strict'

const express = require('express')
const { Router } = express
const db = require('../db')
const env = require('../config/env')
const mediaService = require('../services/media.service')
const sessionService = require('../services/session.service')
const { requireStudentAuth, requireTeacherAuth } = require('../middleware/auth')
const { requestUploadUrlSchema, completeUploadSchema } = require('../schemas/media.schema')

const router = Router()

/**
 * POST /api/v1/media/upload-url
 * Candidate requests authorization and a presigned URL to upload a snapshot.
 */
router.post('/api/v1/media/upload-url', requireStudentAuth, async (req, res, next) => {
  try {
    const validation = requestUploadUrlSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid upload request schema', details: validation.error.format() })
    }

    const { sessionId, mediaType, mimeType, sizeBytes, clientEventId, capturedAt } = validation.data

    // Security Check: Verify session exists and belongs to the authenticated candidate
    const session = await sessionService.getSessionById(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const tokenStudentId = req.student.studentId || req.student.student_id
    if (session.studentId !== tokenStudentId || session.attemptId !== req.student.attemptId) {
      return res.status(403).json({ error: 'Forbidden: Session access denied' })
    }

    // Generate URL and insert database metadata
    const result = await mediaService.requestUploadUrl({
      sessionId,
      mediaType,
      mimeType,
      sizeBytes,
      clientEventId,
      capturedAt
    })

    res.json({
      mediaId: result.mediaId,
      uploadUrl: result.uploadUrl,
      storageKey: result.storageKey,
      expiresIn: result.expiresIn
    })
  } catch (err) { next(err) }
})

/**
 * POST /api/v1/media/:id/complete
 * Candidate informs backend that the upload is completed.
 */
router.post('/api/v1/media/:id/complete', requireStudentAuth, async (req, res, next) => {
  try {
    const validation = completeUploadSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request body', details: validation.error.format() })
    }

    // Security Check: Verify media record belongs to the authenticated candidate
    const mediaRes = await db.query('SELECT proctoring_session_id FROM proctoring_media WHERE id = $1', [req.params.id])
    if (mediaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Media record not found' })
    }

    const sessionId = mediaRes.rows[0].proctoring_session_id
    const session = await sessionService.getSessionById(sessionId)
    const tokenStudentId = req.student.studentId || req.student.student_id
    if (!session || session.studentId !== tokenStudentId || session.attemptId !== req.student.attemptId) {
      return res.status(403).json({ error: 'Forbidden: Media access denied' })
    }

    const updatedMedia = await mediaService.completeUpload(req.params.id, req.body.sizeBytes)
    res.json(updatedMedia)
  } catch (err) { next(err) }
})

/**
 * GET /api/v1/media/:id/url
 * Teacher requests short-lived download URL for an evidence file.
 */
router.get('/api/v1/media/:id/url', requireTeacherAuth, async (req, res, next) => {
  try {
    const mediaId = req.params.id

    // Fetch media and its session details
    const mediaRes = await db.query(
      `SELECT m.*, s.assessment_id
       FROM proctoring_media m
       JOIN proctoring_sessions s ON m.proctoring_session_id = s.id
       WHERE m.id = $1`,
      [mediaId]
    )
    if (mediaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Media record not found' })
    }

    const media = mediaRes.rows[0]

    // Teacher Audit Log
    const teacherEmail = req.teacher.email || 'unknown-teacher'
    console.log(`[audit-trail] Teacher ${teacherEmail} accessed media ID ${mediaId} (session: ${media.proctoring_session_id}, assessment: ${media.assessment_id}) at ${new Date().toISOString()}`)

    const result = await mediaService.getDownloadUrl(mediaId)
    res.json(result)
  } catch (err) { next(err) }
})

/**
 * GET /api/v1/sessions/:sessionId/media
 * Teacher lists all media metadata for a session.
 */
router.get('/api/v1/sessions/:sessionId/media', requireTeacherAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.params

    // Verify session exists
    const session = await sessionService.getSessionById(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const list = await mediaService.listMediaForSession(sessionId)
    res.json({ media: list })
  } catch (err) { next(err) }
})

// ── LOCAL STORAGE SIMULATOR ROUTE ──────────────────────────────────────────────
// Serves as standard bucket endpoint during local testing.

// Direct PUT simulated upload
router.put('/api/v1/media/local-upload', express.raw({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
  try {
    const { key } = req.query
    if (!key) return res.status(400).json({ error: 'Missing key parameter' })
    if (env.MEDIA_STORAGE_PROVIDER !== 'local') {
      return res.status(400).json({ error: 'Local storage not active' })
    }
    await mediaService.storageAdapter.saveBuffer(key, req.body)
    res.status(200).send('OK')
  } catch (err) { next(err) }
})

// Direct GET simulated download
router.get('/api/v1/media/local-download', async (req, res, next) => {
  try {
    const { key } = req.query
    if (!key) return res.status(400).json({ error: 'Missing key parameter' })
    if (env.MEDIA_STORAGE_PROVIDER !== 'local') {
      return res.status(400).json({ error: 'Local storage not active' })
    }
    const exists = await mediaService.storageAdapter.objectExists(key)
    if (!exists) return res.status(404).send('Not Found')
    const buffer = await mediaService.storageAdapter.getBuffer(key)
    res.setHeader('Content-Type', 'image/jpeg')
    res.send(buffer)
  } catch (err) { next(err) }
})

module.exports = router
