'use strict'

/**
 * grading-service/src/index.js
 *
 * Consumes compiler-service verdicts and grades exam answers.
 *
 * Auto-grading (no AI):
 *   - MCQ: answer-key comparison
 *   - output-prediction: exact string match (trim + normalise whitespace)
 *
 * AI-suggested grading:
 *   - coding, debug: send code + expected behaviour to AI model for a score + rationale
 *   - Teacher can review and override any AI grade via the review API
 *
 * TODO: implement actual AI calls (provider TBD — see .env.example)
 * TODO: implement teacher review UI endpoints (not yet scoped — decisions.md #2)
 * TODO: screenshot comparison for widget-test questions (decisions.md #3 — not confirmed)
 */

require('dotenv').config()
const express = require('express')
const cors = require('cors')

const gradingRouter = require('./routes/grading')
const reviewRouter  = require('./routes/review')

const app = express()
const PORT = process.env.GRADING_PORT || 6000

app.use(cors())
app.use(express.json())

app.use('/grade', gradingRouter)
app.use('/review', reviewRouter)

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

app.use((err, _req, res, _next) => {
  console.error('[grading-service]', err)
  res.status(500).json({ error: err.message })
})

app.listen(PORT, () => console.log(`[grading-service] listening on :${PORT}`))
