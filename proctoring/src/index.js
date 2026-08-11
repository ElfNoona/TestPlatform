'use strict'

/**
 * proctoring/src/index.js
 *
 * Handles post-exam video upload from student browsers.
 * Students record locally during the exam and upload after submission.
 * This is NOT a live-streaming service.
 *
 * POST /upload        — accepts a video file, delegates to the storage adapter
 * GET  /status/:id    — check upload status for a given attempt
 *
 * Storage adapter pattern: swap in any provider by implementing the
 * StorageAdapter interface (see adapters/).
 *
 * Current lean: Oracle Cloud (OCI) Block Storage — NOT yet wired up.
 * Active adapter: LocalAdapter (saves to ./uploads/ as a fallback)
 * TODO: implement OciAdapter when provider is confirmed (decisions.md #4)
 */

require('dotenv').config()
const express = require('express')
const multer  = require('multer')
const cors    = require('cors')
const path    = require('path')

const LocalAdapter = require('./adapters/LocalAdapter')
// const OciAdapter = require('./adapters/OciAdapter')  // TODO: swap in when ready

const app  = express()
const PORT = process.env.PROCTORING_PORT || 7000

// Use local adapter by default
const storage = new LocalAdapter(path.join(__dirname, '..', 'uploads'))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },  // 2 GB max
  fileFilter: (_req, file, cb) => {
    // Accept common video MIME types
    if (file.mimetype.startsWith('video/')) cb(null, true)
    else cb(new Error('Only video files are accepted'))
  },
})

app.use(cors())
app.use(express.json())

// ── POST /upload ──────────────────────────────────────────────────────────────
app.post('/upload', upload.single('recording'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const attemptId = req.body.attemptId
    if (!attemptId) return res.status(400).json({ error: 'attemptId is required' })

    // TODO: validate that the attemptId is submitted and belongs to the uploading student
    const result = await storage.save(attemptId, req.file.buffer, req.file.mimetype)

    res.json({ uploaded: true, location: result.location })
  } catch (err) { next(err) }
})

// ── GET /status/:id ───────────────────────────────────────────────────────────
app.get('/status/:id', async (req, res, next) => {
  try {
    const status = await storage.status(req.params.id)
    res.json(status)
  } catch (err) { next(err) }
})

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

app.use((err, _req, res, _next) => {
  console.error('[proctoring]', err)
  res.status(500).json({ error: err.message })
})

app.listen(PORT, () => console.log(`[proctoring] listening on :${PORT}`))
