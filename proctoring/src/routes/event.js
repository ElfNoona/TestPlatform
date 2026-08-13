'use strict'

const { Router } = require('express')
const eventService = require('../services/event.service')
const sessionService = require('../services/session.service')
const { requireStudentAuth } = require('../middleware/auth')
const { batchEventsSchema } = require('../schemas/event.schema')

const router = Router()

/**
 * POST /api/v1/events/batch — Candidates submit batches of events (e.g. on reconnection or offline sync)
 */
router.post('/api/v1/events/batch', requireStudentAuth, async (req, res, next) => {
  try {
    const validation = batchEventsSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid batch events payload schema', details: validation.error.format() })
    }

    const { sessionId, events } = validation.data

    // Security check: Verify session exists and belongs to the authenticated candidate
    const session = await sessionService.getSessionById(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Match candidate UUID
    const authStudentId = req.student.studentId || req.student.student_id
    if (session.studentId !== authStudentId) {
      return res.status(403).json({ error: 'Forbidden: Session does not belong to authenticated student' })
    }

    // Enqueue the events to BullMQ
    await eventService.enqueueEventsBatch(sessionId, events)

    res.json({
      status: 'queued',
      count: events.length
    })
  } catch (err) { next(err) }
})

module.exports = router
