'use strict'

/**
 * routes/admin.js — teacher-authenticated routes for admin operations.
 *
 * GET  /admin/students                        — list all students
 * POST /admin/students                        — upsert a student record
 * GET  /admin/question-sets                   — list question sets
 * POST /admin/question-sets                   — create a new question set
 * POST /admin/question-sets/:id/questions     — bulk-upload questions (transactional)
 * POST /admin/question-sets/:id/publish       — publish a draft question set
 * GET  /admin/question-sets/:id/questions     — list questions in a set
 */

const { Router } = require('express')
const { requireTeacherAuth } = require('../middleware/auth')
const db = require('../db')

const router = Router()

// ── GET /admin/students ──────────────────────────────────────────────────────
router.get('/students', requireTeacherAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, access_code, slot_id, question_set_id, created_at
       FROM students
       ORDER BY name ASC`
    )
    res.json({ students: result.rows })
  } catch (err) { next(err) }
})

// ── POST /admin/students ─────────────────────────────────────────────────────
router.post('/students', requireTeacherAuth, async (req, res, next) => {
  try {
    const { name, accessCode, slotId, questionSetId } = req.body
    if (!name || !accessCode) {
      return res.status(400).json({ error: 'name and accessCode are required' })
    }

    const result = await db.query(
      `INSERT INTO students (name, access_code, slot_id, question_set_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (access_code) DO UPDATE SET
         name             = EXCLUDED.name,
         slot_id          = EXCLUDED.slot_id,
         question_set_id  = EXCLUDED.question_set_id
       RETURNING id, name, access_code, slot_id, question_set_id`,
      [name, accessCode, slotId || null, questionSetId || null]
    )
    res.status(201).json({ student: result.rows[0] })
  } catch (err) { next(err) }
})

// ── GET /admin/question-sets ─────────────────────────────────────────────────
router.get('/question-sets', requireTeacherAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT qs.id, qs.name, qs.version, qs.status, qs.created_at, qs.published_at,
              COUNT(q.id)::int AS question_count
       FROM question_sets qs
       LEFT JOIN questions q ON q.question_set_id = qs.id
       GROUP BY qs.id
       ORDER BY qs.created_at DESC`
    )
    res.json({ questionSets: result.rows })
  } catch (err) { next(err) }
})

// ── POST /admin/question-sets ────────────────────────────────────────────────
router.post('/question-sets', requireTeacherAuth, async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' })
    }

    const result = await db.query(
      `INSERT INTO question_sets (name) VALUES ($1) RETURNING *`,
      [name.trim()]
    )
    res.status(201).json({ questionSet: result.rows[0] })
  } catch (err) { next(err) }
})

// ── POST /admin/question-sets/:id/publish ────────────────────────────────────
router.post('/question-sets/:id/publish', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params

    // Only draft sets can be published
    const check = await db.query(
      `SELECT status FROM question_sets WHERE id = $1`, [id]
    )
    if (check.rows.length === 0) return res.status(404).json({ error: 'Question set not found' })
    if (check.rows[0].status !== 'draft') {
      return res.status(409).json({ error: `Cannot publish a set with status '${check.rows[0].status}'` })
    }

    const result = await db.query(
      `UPDATE question_sets
       SET status = 'published', published_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    )
    res.json({ questionSet: result.rows[0] })
  } catch (err) { next(err) }
})

// ── GET /admin/question-sets/:id/questions ───────────────────────────────────
router.get('/question-sets/:id/questions', requireTeacherAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const result = await db.query(
      `SELECT * FROM questions WHERE question_set_id = $1 ORDER BY order_index ASC`,
      [id]
    )
    res.json({ questions: result.rows })
  } catch (err) { next(err) }
})

// ── POST /admin/question-sets/:id/questions ──────────────────────────────────
/**
 * Bulk-upload questions to a question set.
 *
 * Body: { questions: QuestionInput[] }
 *
 * QuestionInput (all types share base fields):
 *   type            — 'mcq' | 'output-prediction' | 'coding' | 'debug'
 *   prompt          — question text (required)
 *   marks           — integer (required)
 *   order_index     — display position
 *
 * MCQ adds:        options[], correct_answer
 * Output-pred adds: starter_code, correct_answer
 * Coding/Debug add: starter_code, evaluation.evaluation_type,
 *                   evaluation.evaluation_config_id, evaluation.evaluation_config_version
 *
 * Upload is transactional — all questions are inserted or none.
 * A published question set cannot be modified.
 */
router.post('/question-sets/:id/questions', requireTeacherAuth, async (req, res, next) => {
  const client = await db.pool.connect()
  try {
    const { id } = req.params
    const { questions } = req.body

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'questions must be a non-empty array' })
    }

    // Check set exists and is not yet published (immutability)
    const setCheck = await client.query(
      `SELECT id, status FROM question_sets WHERE id = $1`, [id]
    )
    if (setCheck.rows.length === 0) return res.status(404).json({ error: 'Question set not found' })
    if (setCheck.rows[0].status === 'published') {
      return res.status(409).json({ error: 'Cannot modify a published question set. Create a new version instead.' })
    }

    // Validate every question before touching the DB
    const VALID_TYPES = ['mcq', 'output-prediction', 'coding', 'debug']
    const VALID_EVAL_TYPES = ['compiler_tests', 'exact_match', 'normalised_match']

    const errors = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const idx = q.order_index ?? i

      if (!VALID_TYPES.includes(q.type)) {
        errors.push(`[${idx}] invalid type '${q.type}'`)
      }
      if (!q.prompt || typeof q.prompt !== 'string') {
        errors.push(`[${idx}] prompt is required`)
      }
      if (typeof q.marks !== 'number' || q.marks < 0) {
        errors.push(`[${idx}] marks must be a non-negative number`)
      }
      if (q.type === 'mcq') {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          errors.push(`[${idx}] MCQ requires at least 2 options`)
        }
        if (!q.correct_answer) {
          errors.push(`[${idx}] MCQ requires correct_answer`)
        }
      }
      if (q.type === 'output-prediction' && !q.correct_answer) {
        errors.push(`[${idx}] output-prediction requires correct_answer`)
      }
      if (q.type === 'coding' || q.type === 'debug') {
        const ev = q.evaluation || {}
        if (!ev.evaluation_type || !VALID_EVAL_TYPES.includes(ev.evaluation_type)) {
          errors.push(`[${idx}] coding/debug requires evaluation.evaluation_type (${VALID_EVAL_TYPES.join('|')})`)
        }
        if (!ev.evaluation_config_id) {
          errors.push(`[${idx}] coding/debug requires evaluation.evaluation_config_id`)
        }
      }
    }

    if (errors.length > 0) {
      return res.status(422).json({
        error: 'Question validation failed',
        details: errors
      })
    }

    // Transactional bulk insert
    await client.query('BEGIN')

    // Clear existing questions for this set (replacement upload semantics)
    await client.query(`DELETE FROM questions WHERE question_set_id = $1`, [id])

    const inserted = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const ev = q.evaluation || {}
      const result = await client.query(
        `INSERT INTO questions (
           question_set_id, type, prompt, options, starter_code, correct_answer, marks,
           evaluation_type, evaluation_config_id, evaluation_config_version, order_index
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          id,
          q.type,
          q.prompt,
          q.options || null,
          q.starter_code || null,
          q.correct_answer || null,
          q.marks,
          ev.evaluation_type || null,
          ev.evaluation_config_id || null,
          ev.evaluation_config_version || null,
          q.order_index ?? i,
        ]
      )
      inserted.push(result.rows[0])
    }

    await client.query('COMMIT')

    res.status(201).json({
      message: `${inserted.length} question(s) uploaded successfully`,
      questions: inserted
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})

// ── GET /admin/sessions/:sessionId ──────────────────────────────────────────
router.get('/sessions/:sessionId', requireTeacherAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.params

    const sessionResult = await db.query(
      `SELECT * FROM proctoring_sessions WHERE id = $1`,
      [sessionId]
    )
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proctoring session not found' })
    }
    const session = sessionResult.rows[0]

    const studentResult = await db.query(
      `SELECT name, access_code, slot_id FROM students WHERE id = $1`,
      [session.student_id]
    )
    const student = studentResult.rows[0] || { name: 'Unknown Candidate', access_code: '—', slot_id: null }

    const eventsResult = await db.query(
      `SELECT id, type, client_timestamp, server_timestamp, duration_ms, metadata, sequence_number
       FROM proctoring_events
       WHERE proctoring_session_id = $1
       ORDER BY client_timestamp ASC`,
      [sessionId]
    )

    const mediaResult = await db.query(
      `SELECT id, event_id, media_type, status, storage_key, captured_at
       FROM proctoring_media
       WHERE proctoring_session_id = $1
       ORDER BY captured_at ASC`,
      [sessionId]
    )

    const reviewsResult = await db.query(
      `SELECT id, decision, comment, reviewed_at
       FROM proctoring_session_reviews
       WHERE proctoring_session_id = $1
       ORDER BY reviewed_at DESC`,
      [sessionId]
    )

    res.json({
      session,
      student,
      events: eventsResult.rows,
      media: mediaResult.rows,
      reviews: reviewsResult.rows
    })
  } catch (err) { next(err) }
})

// ── POST /admin/sessions/:sessionId/review ───────────────────────────────────
router.post('/sessions/:sessionId/review', requireTeacherAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.params
    const { decision, comment } = req.body

    if (!decision || !['VALID', 'SUSPICIOUS', 'VIOLATION'].includes(decision)) {
      return res.status(400).json({ error: 'decision is required and must be VALID, SUSPICIOUS, or VIOLATION' })
    }

    // Verify session exists
    const check = await db.query(
      `SELECT id FROM proctoring_sessions WHERE id = $1`, [sessionId]
    )
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Proctoring session not found' })
    }

    const teacherId = req.teacher.email

    // Insert review verdict
    const result = await db.query(
      `INSERT INTO proctoring_session_reviews (proctoring_session_id, teacher_id, decision, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sessionId, teacherId, decision, comment || null]
    )

    // Update risk level/status on the session for quick caching
    let riskLevel = 'LOW'
    if (decision === 'SUSPICIOUS') riskLevel = 'MEDIUM'
    if (decision === 'VIOLATION') riskLevel = 'HIGH'
    await db.query(
      `UPDATE proctoring_sessions
       SET risk_level = $1, status = 'REVIEWED', updated_at = now()
       WHERE id = $2`,
      [riskLevel, sessionId]
    )

    res.status(201).json({ review: result.rows[0] })
  } catch (err) { next(err) }
})

module.exports = router

