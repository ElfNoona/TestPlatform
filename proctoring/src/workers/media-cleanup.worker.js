'use strict'

const mediaService = require('../services/media.service')

// Default cleanup interval: every 6 hours
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000

function startCleanupWorker() {
  console.log('[media-cleanup-worker] Initialized. Cleanup scheduled for every 6 hours.')

  const intervalId = setInterval(async () => {
    try {
      await mediaService.cleanupExpiredMedia()
    } catch (err) {
      console.error('[media-cleanup-worker] Error in periodic expired media cleanup:', err)
    }
  }, CLEANUP_INTERVAL_MS)

  // Run once immediately on startup
  mediaService.cleanupExpiredMedia().catch((err) => {
    console.error('[media-cleanup-worker] Initial startup expired media cleanup failed:', err)
  })

  return intervalId
}

module.exports = {
  startCleanupWorker
}
