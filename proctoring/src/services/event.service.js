'use strict'

const { Queue } = require('bullmq')
const IORedis = require('ioredis')
const env = require('../config/env')
const db = require('../db')

// Setup Redis connection for BullMQ
const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false
})

// Initialize the queue
const eventQueue = new Queue('proctoring-events', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: true,
    removeOnFail: 100
  }
})

class EventService {
  constructor() {
    this.redisConnection = redisConnection
    this.eventQueue = eventQueue
  }
  /**
   * Enqueues a single event to the BullMQ processing queue.
   */
  async enqueueEvent(sessionId, event) {
    const jobData = {
      sessionId,
      event
    }
    await eventQueue.add('process-event', jobData)
  }

  /**
   * Enqueues a batch of events to the BullMQ processing queue.
   */
  async enqueueEventsBatch(sessionId, events) {
    // Sort events by sequence number before enqueuing to make processing order correct
    const sortedEvents = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber)

    const jobs = sortedEvents.map((evt) => ({
      name: 'process-event',
      data: { sessionId, event: evt }
    }))

    await eventQueue.addBulk(jobs)
  }

  /**
   * Retrieves all persisted events for a session, ordered by sequence number.
   */
  async getEventsBySession(sessionId) {
    const queryText = `
      SELECT *
      FROM proctoring_events
      WHERE proctoring_session_id = $1
      ORDER BY sequence_number ASC;
    `
    const res = await db.query(queryText, [sessionId])
    return res.rows.map((row) => ({
      id: row.id,
      sessionId: row.proctoring_session_id,
      type: row.type,
      clientTimestamp: row.client_timestamp,
      serverTimestamp: row.server_timestamp,
      durationMs: row.duration_ms,
      metadata: row.metadata,
      sequenceNumber: row.sequence_number,
      clientEventId: row.client_event_id,
      createdAt: row.created_at
    }))
  }
}

module.exports = new EventService()
