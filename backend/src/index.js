'use strict'

require('dotenv').config()
const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')

const attemptsRouter = require('./routes/attempts')
const teacherAuthRouter = require('./routes/teacherAuth')
const adminRouter = require('./routes/admin')

const app = express()
const PORT = process.env.BACKEND_PORT || 4000

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())

// Basic rate limiting — tighten for production
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true }))

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/attempts', attemptsRouter)
app.use('/auth/teacher', teacherAuthRouter)
app.use('/admin', adminRouter)

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// ── Global error handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => console.log(`[backend] listening on :${PORT}`))

module.exports = app
