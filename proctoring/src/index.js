'use strict'

const http = require('http')
const app = require('./app')
const env = require('./config/env')
const migrate = require('./db/migrate')
const db = require('./db')
const { initWebSocket } = require('./websocket')
const eventService = require('./services/event.service')

// Import BullMQ Worker to register and start it in the same process
const { eventWorker, redisConnection: workerRedis } = require('./workers/event.worker')
const { startCleanupWorker } = require('./workers/media-cleanup.worker')

const server = http.createServer(app)

// Initialize WebSocket server
const wss = initWebSocket(server)

let isShuttingDown = false
let cleanupIntervalId = null

async function gracefulShutdown(reason) {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log(`[proctoring-shutdown] starting graceful shutdown. Reason: ${reason}`)

  try {
    // 0. Clear cleanup interval
    if (cleanupIntervalId) {
      console.log('[proctoring-shutdown] clearing media cleanup interval...')
      clearInterval(cleanupIntervalId)
    }

    // 1. Close HTTP server (stops accepting new connections)
    console.log('[proctoring-shutdown] closing HTTP server...')
    await new Promise((resolve) => server.close(resolve))
    console.log('[proctoring-shutdown] HTTP server closed.')

    // 2. Close WebSocket server
    if (wss) {
      console.log('[proctoring-shutdown] closing WebSocket server...')
      await new Promise((resolve) => wss.close(resolve))
      console.log('[proctoring-shutdown] WebSocket server closed.')
    }

    // 3. Close BullMQ Worker
    console.log('[proctoring-shutdown] closing event worker...')
    await eventWorker.close()
    console.log('[proctoring-shutdown] event worker closed.')

    // 4. Close Redis connections
    console.log('[proctoring-shutdown] closing Redis connections...')
    await workerRedis.quit()
    await eventService.redisConnection.quit()
    console.log('[proctoring-shutdown] Redis connections closed.')

    // 5. Close PostgreSQL Pool
    console.log('[proctoring-shutdown] closing database pool...')
    await db.pool.end()
    console.log('[proctoring-shutdown] database pool closed.')

    console.log('[proctoring-shutdown] graceful shutdown completed.')
    if (reason === 'uncaughtException') {
      process.exit(1)
    } else {
      process.exit(0)
    }
  } catch (err) {
    console.error('[proctoring-shutdown] error during graceful shutdown:', err)
    process.exit(1)
  }
}

// Register signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection] Unhandled Promise Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Fatal Uncaught Exception thrown:', err)
  gracefulShutdown('uncaughtException')
})

async function startServer() {
  try {
    // 1. Run migrations before accepting traffic
    await migrate()

    // 2. Start cleanup worker
    cleanupIntervalId = startCleanupWorker()

    // 3. Start listening
    server.listen(env.PORT, () => {
      console.log(`[proctoring] Service successfully started on port :${env.PORT}`)
    })
  } catch (err) {
    console.error('[proctoring-bootstrap] Failed to bootstrap proctoring service:', err)
    process.exit(1)
  }
}

startServer()
