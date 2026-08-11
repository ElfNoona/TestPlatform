'use strict'

/**
 * routes/teacherAuth.js — teacher authentication routes.
 *
 * ⚠️  PROVIDER NOT YET CHOSEN — see docs/decisions.md #1
 *     Options: magic link vs Google OAuth restricted to allowlist.
 *     Both stubs are present below; implement only one.
 *
 * POST /auth/teacher/magic-link   — send magic link email
 * GET  /auth/teacher/magic-link/verify?token=...  — verify and issue JWT
 * GET  /auth/teacher/google       — initiate Google OAuth (alternative)
 * GET  /auth/teacher/google/callback — OAuth callback (alternative)
 */

const { Router } = require('express')
const router = Router()

// ── Magic Link (Option A) ────────────────────────────────────────────────────
router.post('/magic-link', async (req, res, next) => {
  try {
    const { email } = req.body
    // TODO: validate email is in TEACHER_ALLOWLIST_EMAILS
    // TODO: generate signed token (e.g. JWT with short expiry or HMAC)
    // TODO: send email via transactional email provider (not yet chosen)
    res.json({ message: 'Magic link sent (TODO: not yet implemented)' })
  } catch (err) { next(err) }
})

router.get('/magic-link/verify', async (req, res, next) => {
  try {
    const { token } = req.query
    // TODO: verify token signature and expiry
    // TODO: check email is in allowlist
    // TODO: issue teacher JWT and redirect to grading UI
    res.json({ token: 'TODO', role: 'teacher' })
  } catch (err) { next(err) }
})

// ── Google OAuth (Option B) ──────────────────────────────────────────────────
router.get('/google', (_req, res) => {
  // TODO: redirect to Google OAuth consent screen
  // TODO: use passport-google-oauth20 or googleapis
  res.json({ message: 'Google OAuth not yet implemented — see decisions.md #1' })
})

router.get('/google/callback', async (req, res, next) => {
  try {
    // TODO: handle OAuth callback, validate email in allowlist
    // TODO: issue teacher JWT
    res.json({ message: 'Google OAuth callback not yet implemented' })
  } catch (err) { next(err) }
})

module.exports = router
