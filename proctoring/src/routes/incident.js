'use strict'

const { Router } = require('express')
const incidentService = require('../services/incident.service')
const reviewService = require('../services/review.service')
const { requireTeacherAuth } = require('../middleware/auth')
const { createReviewSchema } = require('../schemas/review.schema')

const router = Router()

/**
 * GET /api/v1/incidents — List all incidents, supports filters (?status=..., ?severity=..., ?sessionId=...)
 */
router.get('/api/v1/incidents', requireTeacherAuth, async (req, res, next) => {
  try {
    const { status, severity, sessionId } = req.query
    const incidents = await incidentService.listAllIncidents({ status, severity, sessionId })
    res.json(incidents)
  } catch (err) { next(err) }
})

/**
 * GET /api/v1/incidents/:id — Get details of a single incident
 */
router.get('/api/v1/incidents/:id', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const incident = await incidentService.getIncidentById(id)
    if (!incident) return res.status(404).json({ error: 'Incident not found' })

    // Also get the reviews for this incident
    const reviews = await reviewService.getReviewsForIncident(id)

    res.json({
      ...incident,
      reviews
    })
  } catch (err) { next(err) }
})

/**
 * POST /api/v1/incidents/:id/review — Record a teacher review/decision for an incident
 */
router.post('/api/v1/incidents/:id/review', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const validation = createReviewSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid payload schema', details: validation.error.format() })
    }

    const incident = await incidentService.getIncidentById(id)
    if (!incident) return res.status(404).json({ error: 'Incident not found' })

    const { decision, comment } = validation.data
    const teacherId = req.teacher.studentId || req.teacher.email || 'teacher-default-uuid' // Fallback helper

    const review = await reviewService.createReview({
      incidentId: id,
      teacherId,
      decision,
      comment
    })

    res.status(201).json(review)
  } catch (err) { next(err) }
})

module.exports = router
