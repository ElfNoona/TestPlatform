'use strict'

const { Router } = require('express')
const db = require('../db')
const eventService = require('../services/event.service')

const router = Router()

/**
 * GET / — Retrieve proctoring service health status (mounted under /health and /api/v1/health)
 */
router.get('/', async (req, res) => {
  const components = {
    api: 'healthy',
    database: 'degraded',
    redis: 'degraded',
    queue: 'degraded'
  }
  let isHealthy = true

  // 1. Check PostgreSQL
  try {
    await db.query('SELECT 1')
    components.database = 'healthy'
  } catch (err) {
    console.error('[health] DB check failed:', err.message)
    components.database = 'degraded'
    isHealthy = false
  }

  // 2. Check Redis and BullMQ Queue
  try {
    const pingRes = await eventService.redisConnection.ping()
    if (pingRes === 'PONG') {
      components.redis = 'healthy'
      components.queue = 'healthy'
    } else {
      components.redis = 'degraded'
      components.queue = 'degraded'
      isHealthy = false
    }
  } catch (err) {
    console.error('[health] Redis check failed:', err.message)
    components.redis = 'degraded'
    components.queue = 'degraded'
    isHealthy = false
  }

  const status = isHealthy ? 'healthy' : 'degraded'
  const statusCode = isHealthy ? 200 : 503

  res.status(statusCode).json({
    status,
    components
  })
})

module.exports = router
