'use strict'

const { Router } = require('express')
const sessionService = require('../services/session.service')
const eventService = require('../services/event.service')
const reviewService = require('../services/review.service')
const { requireServiceAuth } = require('../middleware/service-auth')
const { requireTeacherAuth } = require('../middleware/auth')
const { createSessionSchema } = require('../schemas/session.schema')
const { createSessionReviewSchema } = require('../schemas/review.schema')

const router = Router()

// ── INTERNAL SERVICE-TO-SERVICE ENDPOINTS ──────────────────────────────────────

/**
 * POST /internal/sessions — Create a proctoring session (requested by backend when student starts exam)
 */
router.post('/internal/sessions', requireServiceAuth, async (req, res, next) => {
  try {
    const validation = createSessionSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid payload schema', details: validation.error.format() })
    }

    const { assessmentSessionId, candidateId, assessmentId } = validation.data
    const session = await sessionService.createSession({ assessmentSessionId, candidateId, assessmentId })

    res.status(201).json({
      proctoringSessionId: session.id,
      status: session.status
    })
  } catch (err) { next(err) }
})

/**
 * POST /internal/sessions/:id/end — End a proctoring session (requested by backend when student submits exam)
 */
router.post('/internal/sessions/:id/end', requireServiceAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const session = await sessionService.endSession(id)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const summary = await sessionService.getSessionSummary(id)

    res.json(summary)
  } catch (err) { next(err) }
})

/**
 * GET /internal/sessions/:id/status — Get detailed session status (internal query)
 */
router.get('/internal/sessions/:id/status', requireServiceAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const session = await sessionService.getSessionById(id)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    res.json(session)
  } catch (err) { next(err) }
})

// ── TEACHER / ADMIN DASHBOARD ENDPOINTS ─────────────────────────────────────────

/**
 * GET /api/v1/sessions/:id/summary — Get summary statistics of a candidate's session
 */
router.get('/api/v1/sessions/:id/summary', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const summary = await sessionService.getSessionSummary(id)
    if (!summary) return res.status(404).json({ error: 'Session not found' })

    res.json(summary)
  } catch (err) { next(err) }
})

/**
 * GET /api/v1/sessions/:id/timeline — Fetch chronological timeline of all events
 */
router.get('/api/v1/sessions/:id/timeline', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const events = await eventService.getEventsBySession(id)
    res.json(events)
  } catch (err) { next(err) }
})

/**
 * GET /api/v1/assessments/:id/overview — Aggregated metrics for live/completed attempts
 */
router.get('/api/v1/assessments/:id/overview', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params // assessment UUID
    const overview = await sessionService.getAssessmentOverview(id)
    res.json(overview)
  } catch (err) { next(err) }
})

/**
 * POST /api/v1/sessions/:id/review — Record a session-level integrity decision
 */
router.post('/api/v1/sessions/:id/review', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const validation = createSessionReviewSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid payload schema', details: validation.error.format() })
    }

    const session = await sessionService.getSessionById(id) || await sessionService.getSessionByAttemptId(id)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { decision, comment } = validation.data
    const teacherId = req.user?.teacherId || '00000000-0000-0000-0000-000000000000'

    const review = await reviewService.createSessionReview({
      sessionId: session.id,
      teacherId,
      decision,
      comment
    })

    res.status(201).json(review)
  } catch (err) { next(err) }
})

/**
 * GET /api/v1/sessions/:id/review — Get latest overall decision and full history for a session
 */
router.get('/api/v1/sessions/:id/review', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const session = await sessionService.getSessionById(id) || await sessionService.getSessionByAttemptId(id)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const history = await reviewService.getSessionReviews(session.id)
    const latest = history[0] || null

    res.json({
      currentDecision: latest ? latest.decision : null,
      reviewer: latest ? latest.teacherId : null,
      reviewedAt: latest ? latest.reviewedAt : null,
      history
    })
  } catch (err) { next(err) }
})

module.exports = router
