'use strict'

/**
 * compiler-service/api/src/index.js
 *
 * Express API that accepts code-run requests and enqueues them into BullMQ.
 * Returns a job ID immediately; callers poll GET /jobs/:id for results.
 *
 * POST /run          — submit code for execution
 * GET  /jobs/:id     — poll job status and result
 * GET  /health       — liveness probe
 */

require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { Queue } = require('bullmq')
const { v4: uuidv4 } = require('uuid')

const app = express()
const PORT = process.env.COMPILER_API_PORT || 5000
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Parse redis URL for BullMQ connection options
const redisUrl = new URL(REDIS_URL)
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
}

const execQueue = new Queue('exec', { connection: redisConnection })

app.use(cors())
app.use(express.json())

// ── POST /run ────────────────────────────────────────────────────────────────
app.post('/run', async (req, res, next) => {
  try {
    const { code, stdin = '', timeoutMs = 10_000 } = req.body
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code is required and must be a string' })
    }

    const jobId = uuidv4()
    await execQueue.add('run', { code, stdin, timeoutMs }, {
      jobId,
      // TODO: tune removeOnComplete / removeOnFail for production
      removeOnComplete: { age: 3600 },
      removeOnFail:    { age: 3600 },
    })

    res.status(202).json({ jobId, status: 'queued' })
  } catch (err) { next(err) }
})

// ── GET /jobs/:id ────────────────────────────────────────────────────────────
app.get('/jobs/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const job = await execQueue.getJob(id)
    if (!job) return res.status(404).json({ error: 'Job not found' })

    const state = await job.getState()
    const result = job.returnvalue ?? null

    res.json({ jobId: id, state, result })
    // State values: waiting | active | completed | failed | delayed | unknown
  } catch (err) { next(err) }
})

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[compiler-api]', err)
  res.status(500).json({ error: err.message })
})

app.listen(PORT, () => console.log(`[compiler-api] listening on :${PORT}`))
