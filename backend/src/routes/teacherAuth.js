'use strict'

/**
 * routes/teacherAuth.js — teacher authentication routes.
 *
 * POST /auth/teacher/login        — verify teacher access code and issue JWT
 * POST /auth/teacher/magic-link   — send magic link email (legacy stub)
 * GET  /auth/teacher/magic-link/verify?token=...  — verify and issue JWT (legacy stub)
 */

const { Router } = require('express')
const jwt = require('jsonwebtoken')
const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

// ── Teacher Access Code Login ───────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { code } = req.body
    const teacherCode = process.env.TEACHER_ACCESS_CODE || 'TEACHER-2026'

    if (!code) {
      return res.status(400).json({ error: 'Access code is required' })
    }

    if (code.trim().toUpperCase() !== teacherCode.toUpperCase()) {
      return res.status(403).json({ error: 'Invalid teacher access code' })
    }

    const token = jwt.sign(
      { email: 'teacher@krs.org', role: 'teacher' },
      JWT_SECRET
    )

    res.json({ token, role: 'teacher' })
  } catch (err) { next(err) }
})

// ── Magic Link (Option A) ────────────────────────────────────────────────────
router.post('/magic-link', async (req, res, next) => {
  try {
    const { email } = req.body
    res.json({ message: 'Magic link sent (TODO: not yet implemented)' })
  } catch (err) { next(err) }
})

router.get('/magic-link/verify', async (req, res, next) => {
  try {
    res.json({ token: 'TODO', role: 'teacher' })
  } catch (err) { next(err) }
})

// ── Google OAuth (Option B) ──────────────────────────────────────────────────
router.get('/google', (_req, res) => {
  res.json({ message: 'Google OAuth not yet implemented — see decisions.md #1' })
})

router.get('/google/callback', async (req, res, next) => {
  try {
    res.json({ message: 'Google OAuth callback not yet implemented' })
  } catch (err) { next(err) }
})

module.exports = router

