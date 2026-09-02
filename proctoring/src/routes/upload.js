'use strict'

const { Router } = require('express')
const multer = require('multer')
const path = require('path')
const LocalAdapter = require('../adapters/LocalAdapter')

const router = Router()

// Initialize local adapter (saves to ../../uploads/)
const storage = new LocalAdapter(path.join(__dirname, '..', '..', 'uploads'))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true)
    else cb(new Error('Only video files are accepted'))
  }
})

// POST /upload - accepts video file, delegates to storage adapter
router.post('/upload', upload.single('recording'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const attemptId = req.body.attemptId
    if (!attemptId) return res.status(400).json({ error: 'attemptId is required' })

    const result = await storage.save(attemptId, req.file.buffer, req.file.mimetype)

    res.json({ uploaded: true, location: result.location })
  } catch (err) { next(err) }
})

// GET /status/:id - check upload status for a given attempt
router.get('/status/:id', async (req, res, next) => {
  try {
    const status = await storage.status(req.params.id)
    res.json(status)
  } catch (err) { next(err) }
})

module.exports = router
