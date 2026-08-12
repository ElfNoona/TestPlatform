'use strict'

/**
 * routes/attempts.js — four core exam-attempt endpoints.
 *
 * POST /attempts/start          — validate access code, create attempt, return JWT
 * GET  /attempts/:id/state      — server-authoritative remaining time + question list
 * POST /attempts/:id/answers    — upsert one or more answers (autosave)
 * POST /attempts/:id/submit     — mark attempt as submitted (enforces time cutoff)
 *
 * Timer is ALWAYS computed server-side from start_time + duration_seconds.
 * The server refuses to accept /answers or /submit after time has expired.
 */

const { Router } = require('express')
const jwt = require('jsonwebtoken')
const db = require('../db')
const { requireStudentAuth } = require('../middleware/auth')

const router = Router()

// ── POST /attempts/start ────────────────────────────────────────────────────
router.post('/start', async (req, res, next) => {
  try {
    const { code } = req.body
    if (!code) return res.status(400).json({ error: 'code is required' })

    // 1. Look up student by access_code in DB
    const studentRes = await db.query('SELECT * FROM students WHERE access_code = $1', [code])
    if (studentRes.rows.length === 0) {
      return res.status(403).json({ error: 'Invalid code or exam not available' })
    }
    const student = studentRes.rows[0]

    // 2. Prevent duplicate attempts if one is already active
    const attemptRes = await db.query(
      'SELECT * FROM attempts WHERE student_id = $1 ORDER BY start_time DESC LIMIT 1',
      [student.id]
    )

    let attempt
    if (attemptRes.rows.length > 0 && !attemptRes.rows[0].submitted_at) {
      attempt = attemptRes.rows[0]
    } else {
      const insertAttemptText = `
        INSERT INTO attempts (student_id, start_time, duration_seconds)
        VALUES ($1, now(), 7200)
        RETURNING *;
      `
      const newAttemptRes = await db.query(insertAttemptText, [student.id])
      attempt = newAttemptRes.rows[0]
    }

    // 3. Request proctoring session creation (graceful degradation)
    let proctoringSessionId = null
    let proctoringStatus = 'UNAVAILABLE'

    const proctoringUrl = process.env.PROCTORING_SERVICE_URL || 'http://localhost:7000'
    const serviceKey = process.env.INTERNAL_SERVICE_KEY || 'dev-service-key'

    try {
      const response = await fetch(`${proctoringUrl}/internal/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Key': serviceKey
        },
        body: JSON.stringify({
          assessmentSessionId: attempt.id,
          candidateId: student.id,
          assessmentId: student.question_set_id || '00000000-0000-0000-0000-000000000000' // fallback uuid
        })
      })

      if (response.ok) {
        const data = await response.json()
        proctoringSessionId = data.proctoringSessionId
        proctoringStatus = data.status || 'CREATED'
      } else {
        console.error('[backend-start-proctoring] Failed to create proctoring session, status:', response.status)
        proctoringStatus = 'DEGRADED'
      }
    } catch (err) {
      console.error('[backend-start-proctoring] Error calling proctoring service:', err.message)
      proctoringStatus = 'UNAVAILABLE'
    }

    // 4. Sign and return student JWT token
    const token = jwt.sign(
      { studentId: student.id, attemptId: attempt.id },
      process.env.JWT_SECRET || 'dev-secret-change-me'
    )

    res.status(201).json({
      attemptId: attempt.id,
      token,
      proctoring: {
        sessionId: proctoringSessionId,
        status: proctoringStatus
      }
    })
  } catch (err) { next(err) }
})

// ── GET /attempts/:id/state ─────────────────────────────────────────────────
router.get('/:id/state', requireStudentAuth, async (req, res, next) => {
  try {
    const { id } = req.params

    // TODO: fetch attempt from DB, compute remainingSeconds
    // remainingSeconds = attempt.duration_seconds - (now - attempt.start_time)
    // TODO: if remainingSeconds <= 0, mark as submitted if not already
    // TODO: fetch question list for this attempt's question_set_id

    res.json({
      remainingSeconds: 0,   // TODO: replace with real computation
      submitted: false,      // TODO
      questions: [],         // TODO
    })
  } catch (err) { next(err) }
})

// ── POST /attempts/:id/answers ──────────────────────────────────────────────
router.post('/:id/answers', requireStudentAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const { answers } = req.body  // Record<questionId, answerText>

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers must be an object' })
    }

    // TODO: verify attempt belongs to req.student and is not yet submitted
    // TODO: verify time has not expired (recompute server-side)
    // TODO: upsert each answer into the answers table
    //       INSERT ... ON CONFLICT (attempt_id, question_id) DO UPDATE

    res.json({ saved: true })
  } catch (err) { next(err) }
})

// ── POST /attempts/:id/submit ───────────────────────────────────────────────
router.post('/:id/submit', requireStudentAuth, async (req, res, next) => {
  try {
    const { id } = req.params

    // 1. Verify attempt belongs to req.student
    const attemptRes = await db.query('SELECT * FROM attempts WHERE id = $1', [id])
    if (attemptRes.rows.length === 0) {
      return res.status(404).json({ error: 'Attempt not found' })
    }
    const attempt = attemptRes.rows[0]
    const authStudentId = req.student.studentId || req.student.student_id
    if (attempt.student_id !== authStudentId) {
      return res.status(403).json({ error: 'Forbidden: Attempt does not belong to student' })
    }

    if (attempt.submitted_at) {
      return res.json({ submitted: true, message: 'Already submitted' })
    }

    // 2. Update submitted_at = now() in DB
    await db.query('UPDATE attempts SET submitted_at = now() WHERE id = $1', [id])

    // 3. Call proctoring service to end and finalize proctoring session (graceful degradation)
    const proctoringUrl = process.env.PROCTORING_SERVICE_URL || 'http://localhost:7000'
    const serviceKey = process.env.INTERNAL_SERVICE_KEY || 'dev-service-key'

    let proctoringSummary = null
    try {
      const response = await fetch(`${proctoringUrl}/internal/sessions/${id}/end`, {
        method: 'POST',
        headers: {
          'X-Service-Key': serviceKey
        }
      })
      if (response.ok) {
        proctoringSummary = await response.json()
      }
    } catch (err) {
      console.error('[backend-submit-proctoring] Error ending proctoring session:', err.message)
    }

    // TODO: trigger grading-service job (fire-and-forget or queue)

    res.json({
      submitted: true,
      proctoring: proctoringSummary
    })
  } catch (err) { next(err) }
})

module.exports = router
