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
const db = require('../db')
const { requireStudentAuth } = require('../middleware/auth')

const router = Router()

// ── POST /attempts/start ────────────────────────────────────────────────────
router.post('/start', async (req, res, next) => {
  try {
    const { code } = req.body
    if (!code) return res.status(400).json({ error: 'code is required' })

    // TODO: look up student by access_code in DB
    // TODO: check the student's slot is currently open (time window check)
    // TODO: prevent duplicate attempts if one is already active
    const student = null // placeholder
    if (!student) return res.status(403).json({ error: 'Invalid code or exam not available' })

    // TODO: create attempt row in DB (start_time = now())
    // TODO: sign and return a JWT { studentId, attemptId }
    res.status(201).json({ attemptId: 'TODO', token: 'TODO' })
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

    // TODO: verify attempt belongs to req.student
    // TODO: check already submitted → idempotent 200
    // TODO: update submitted_at = now() in DB
    // TODO: trigger grading-service job (fire-and-forget or queue)

    res.json({ submitted: true })
  } catch (err) { next(err) }
})

module.exports = router
