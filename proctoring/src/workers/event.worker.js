'use strict'

const { Worker } = require('bullmq')
const IORedis = require('ioredis')
const env = require('../config/env')
const db = require('../db')
const riskService = require('../services/risk.service')
const incidentService = require('../services/incident.service')
const sessionService = require('../services/session.service')

// Setup Redis connection for BullMQ Worker
const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false
})

/**
 * atomicUpdateCounters - atomically updates session counters based on event type.
 */
async function atomicUpdateCounters(sessionId, eventType) {
  const queryText = `
    UPDATE proctoring_sessions
    SET
      tab_switch_count = CASE WHEN $1 = 'TAB_HIDDEN' THEN tab_switch_count + 1 ELSE tab_switch_count END,
      fullscreen_exit_count = CASE WHEN $1 = 'FULLSCREEN_EXITED' THEN fullscreen_exit_count + 1 ELSE fullscreen_exit_count END,
      copy_count = CASE WHEN $1 = 'COPY' THEN copy_count + 1 ELSE copy_count END,
      paste_count = CASE WHEN $1 = 'PASTE' THEN paste_count + 1 ELSE paste_count END,
      camera_interruptions = CASE WHEN $1 = 'CAMERA_STOPPED' THEN camera_interruptions + 1 ELSE camera_interruptions END,
      screen_interruptions = CASE WHEN $1 = 'SCREEN_SHARE_STOPPED' THEN screen_interruptions + 1 ELSE screen_interruptions END,
      updated_at = now()
    WHERE id = $2
    RETURNING *;
  `
  const res = await db.query(queryText, [eventType, sessionId])
  if (res.rows.length === 0) return null
  return res.rows[0]
}

/**
 * Core event processing pipeline.
 */
async function processEventJob(job) {
  const { sessionId, event } = job.data

  console.log(`[proctoring-worker] processing event ${event.clientEventId} (type: ${event.type}) for session ${sessionId}`)

  try {
    // Fetch session status to determine late-event logic
    const sessionRes = await db.query(
      'SELECT status FROM proctoring_sessions WHERE id = $1',
      [sessionId]
    )
    if (sessionRes.rows.length === 0) {
      console.warn(`[proctoring-worker] session ${sessionId} not found for event ${event.clientEventId}`)
      return { status: 'skipped', reason: 'session_not_found' }
    }

    const sessionStatus = sessionRes.rows[0].status

    if (sessionStatus === 'ENDED') {
      // Late Event Policy: store as LATE_EVENT, preserve original details in metadata, bypass score/incident engine
      const insertEventText = `
        INSERT INTO proctoring_events (
          proctoring_session_id,
          type,
          client_timestamp,
          duration_ms,
          metadata,
          sequence_number,
          client_event_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (proctoring_session_id, client_event_id) DO NOTHING
        RETURNING *;
      `
      const metadata = {
        originalType: event.type,
        originalPayload: event.metadata || {},
        reason: 'SESSION_ENDED'
      }
      const insertValues = [
        sessionId,
        'LATE_EVENT',
        event.clientTimestamp,
        event.durationMs || 0,
        JSON.stringify(metadata),
        event.sequenceNumber,
        event.clientEventId
      ]

      const res = await db.query(insertEventText, insertValues)
      if (res.rows.length === 0) {
        console.log(`[proctoring-worker] duplicate late event ignored (clientEventId: ${event.clientEventId})`)
        return { status: 'skipped', reason: 'duplicate_event' }
      }

      console.log(`[proctoring-worker] late event recorded as LATE_EVENT (clientEventId: ${event.clientEventId})`)
      return { status: 'success', clientEventId: event.clientEventId, late: true }
    }

    // 1. Persist the event to DB (handles uniqueness idempotency via ON CONFLICT DO NOTHING)
    const insertEventText = `
      INSERT INTO proctoring_events (
        proctoring_session_id,
        type,
        client_timestamp,
        duration_ms,
        metadata,
        sequence_number,
        client_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (proctoring_session_id, client_event_id) DO NOTHING
      RETURNING *;
    `
    const insertValues = [
      sessionId,
      event.type,
      event.clientTimestamp,
      event.durationMs || 0,
      JSON.stringify(event.metadata || {}),
      event.sequenceNumber,
      event.clientEventId
    ]

    const insertRes = await db.query(insertEventText, insertValues)
    if (insertRes.rows.length === 0) {
      console.log(`[proctoring-worker] duplicate event ignored (clientEventId: ${event.clientEventId})`)
      return { status: 'skipped', reason: 'duplicate_event' }
    }

    const persistedEvent = insertRes.rows[0]

    // 2. Atomically update aggregate session counter
    const updatedSessionRaw = await atomicUpdateCounters(sessionId, event.type)
    if (!updatedSessionRaw) {
      console.warn(`[proctoring-worker] session ${sessionId} not found for counter update.`)
      return { status: 'skipped', reason: 'session_not_found' }
    }

    const session = sessionService._mapToCamelCase(updatedSessionRaw)

    // 3. Recalculate Risk Score
    const updatedRisk = await riskService.calculateAndUpdateSessionRisk(sessionId)

    // Update risk in local session representation for incident evaluation
    session.riskScore = updatedRisk.riskScore
    session.riskLevel = updatedRisk.riskLevel

    // 4. Incident Detection
    const triggeredIncident = await incidentService.detectAndTriggerIncident(session, persistedEvent)

    return {
      status: 'success',
      clientEventId: event.clientEventId,
      risk: updatedRisk,
      incidentTriggered: !!triggeredIncident
    }
  } catch (err) {
    console.error(`[proctoring-worker] error processing event ${event.clientEventId || 'unknown'}:`, err)
    // Throw error to trigger BullMQ retry backoff
    throw err
  }
}

// Instantiate and start the worker
const eventWorker = new Worker('proctoring-events', processEventJob, {
  connection: redisConnection,
  concurrency: 5
})

eventWorker.on('completed', (job, result) => {
  console.log(`[proctoring-worker] job ${job.id} completed. Result:`, result)
})

eventWorker.on('failed', (job, err) => {
  console.error(`[proctoring-worker] job ${job?.id} failed with error:`, err)
})

module.exports = {
  eventWorker,
  redisConnection,
  processEventJob
}
