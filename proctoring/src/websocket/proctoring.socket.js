'use strict'

const jwt = require('jsonwebtoken')
const url = require('url')
const env = require('../config/env')
const db = require('../db')
const sessionService = require('../services/session.service')
const eventService = require('../services/event.service')
const { CONNECTION_STATUS, HEARTBEAT_THRESHOLD_MS } = require('../config/constants')
const { eventItemSchema } = require('../schemas/event.schema')

const activeConnections = new Map()

/**
 * Handles incoming WebSocket connection and events for a proctoring session.
 *
 * @param {import('ws').WebSocket} ws - WebSocket client connection
 * @param {import('http').IncomingMessage} request - Upgrade request
 * @param {string} sessionId - Session UUID
 */
async function handleProctoringConnection(ws, request, sessionId) {
  const actionTimestamps = []
  const heartbeatTimestamps = []
  let consecutiveViolations = 0

  // Connection replacement registry: Close old socket if active to resolve multi-tab/refresh drops
  if (activeConnections.has(sessionId)) {
    const oldWs = activeConnections.get(sessionId)
    console.log(`[ws-socket] Closing old duplicate connection for session ${sessionId}`)
    oldWs.close(4009, 'Replaced by new connection')
  }
  activeConnections.set(sessionId, ws)

  // 1. Extract and validate auth token from query parameters
  const parsedUrl = url.parse(request.url, true)
  const token = parsedUrl.query.token

  if (!token) {
    activeConnections.delete(sessionId)
    ws.close(4001, 'Unauthorized: Missing token')
    return
  }

  let tokenPayload
  try {
    tokenPayload = jwt.verify(token, env.JWT_SECRET)
  } catch (err) {
    activeConnections.delete(sessionId)
    ws.close(4001, 'Unauthorized: Invalid token')
    return
  }

  // 2. Retrieve session and validate permission
  const session = await sessionService.getSessionById(sessionId)
  if (!session) {
    activeConnections.delete(sessionId)
    ws.close(4004, 'Session not found')
    return
  }

  if (session.status === 'ENDED') {
    activeConnections.delete(sessionId)
    ws.close(4005, 'Session already ended')
    return
  }

  // Double check permission: studentId in token must match studentId in session
  const tokenStudentId = tokenPayload.studentId || tokenPayload.student_id
  if (session.studentId !== tokenStudentId) {
    activeConnections.delete(sessionId)
    ws.close(4003, 'Forbidden: Student ID mismatch')
    return
  }

  console.log(`[ws-socket] Client connected for session ${sessionId}. Student: ${session.studentId}`)

  // 3. Mark connection as active
  await sessionService.updateHeartbeat(sessionId, CONNECTION_STATUS.CONNECTED)

  // Track connection health
  let lastMessageTime = Date.now()
  let connectionState = CONNECTION_STATUS.CONNECTED

  // Send CONNECTED handshake on connection
  ws.send(JSON.stringify({ event: 'CONNECTED', sessionId }))

  // Check connection health periodically
  const healthCheckInterval = setInterval(async () => {
    const idleTime = Date.now() - lastMessageTime

    if (idleTime > HEARTBEAT_THRESHOLD_MS && connectionState !== CONNECTION_STATUS.UNSTABLE) {
      connectionState = CONNECTION_STATUS.UNSTABLE
      console.log(`[ws-socket] Session ${sessionId} connection marked UNSTABLE (idle: ${Math.round(idleTime / 1000)}s)`)
      await sessionService.updateHeartbeat(sessionId, CONNECTION_STATUS.UNSTABLE).catch((e) => {
        console.error(`[ws-socket] failed to update heartbeat status to unstable:`, e)
      })
      ws.send(JSON.stringify({ event: 'CONNECTION_WARNING', status: CONNECTION_STATUS.UNSTABLE }))
    }
  }, 10000)

  // Handle incoming messages
  ws.on('message', async (data) => {
    try {
      lastMessageTime = Date.now()

      // Reset to connected if it was unstable
      if (connectionState === CONNECTION_STATUS.UNSTABLE) {
        connectionState = CONNECTION_STATUS.CONNECTED
        await sessionService.updateHeartbeat(sessionId, CONNECTION_STATUS.CONNECTED)
        ws.send(JSON.stringify({ event: 'CONNECTION_RESTORED', status: CONNECTION_STATUS.CONNECTED }))
      }

      // Payload size limit check: max 10 KB
      if (data.length > 10240) {
        console.warn(`[ws-socket] Session ${sessionId} payload size exceeded: ${data.length} bytes`)
        ws.close(4008, 'Payload size exceeded')
        return
      }

      const rawMsg = JSON.parse(data.toString())
      console.log('[ws-socket] message received:', rawMsg)

      // Metadata size limit check: max 2 KB on stringified metadata
      if (rawMsg.metadata && typeof rawMsg.metadata === 'object') {
        const metadataStr = JSON.stringify(rawMsg.metadata)
        if (metadataStr.length > 2048) {
          console.warn(`[ws-socket] Session ${sessionId} metadata size exceeded: ${metadataStr.length} bytes`)
          ws.close(4008, 'Metadata size exceeded')
          return
        }
      }

      // Rate limit check
      const now = Date.now()
      if (rawMsg.type === 'HEARTBEAT') {
        // Heartbeat limit: max 1 per 8 seconds
        while (heartbeatTimestamps.length > 0 && heartbeatTimestamps[0] < now - 8000) {
          heartbeatTimestamps.shift()
        }
        if (heartbeatTimestamps.length >= 1) {
          consecutiveViolations++
          console.warn(`[ws-socket] Session ${sessionId} heartbeat rate limited. Violation count: ${consecutiveViolations}`)
          ws.send(JSON.stringify({
            event: 'ERROR',
            code: 'RATE_LIMITED',
            clientEventId: rawMsg.clientEventId,
            retryAfterMs: 5000
          }))
          if (consecutiveViolations >= 5) {
            console.warn(`[ws-socket] Terminating session ${sessionId} due to rate limiting (heartbeat flooding)`)
            ws.close(4010, 'Rate limit flooding (heartbeat)')
          }
          return
        }
        heartbeatTimestamps.push(now)
      } else {
        // General action limit: max 20 per 5 seconds
        while (actionTimestamps.length > 0 && actionTimestamps[0] < now - 5000) {
          actionTimestamps.shift()
        }
        if (actionTimestamps.length >= 20) {
          consecutiveViolations++
          console.warn(`[ws-socket] Session ${sessionId} action rate limited. Violation count: ${consecutiveViolations}`)
          ws.send(JSON.stringify({
            event: 'ERROR',
            code: 'RATE_LIMITED',
            clientEventId: rawMsg.clientEventId,
            retryAfterMs: 2000
          }))
          if (consecutiveViolations >= 5) {
            console.warn(`[ws-socket] Terminating session ${sessionId} due to rate limiting (action flooding)`)
            ws.close(4010, 'Rate limit flooding (actions)')
          }
          return
        }
        actionTimestamps.push(now)
      }

      // Reset consecutive violations on successful non-rate-limited processing
      consecutiveViolations = 0

      // Validate message structure
      const validation = eventItemSchema.safeParse(rawMsg)
      if (!validation.success) {
        console.warn('[ws-socket] validation failed:', validation.error.format())
        ws.send(JSON.stringify({ event: 'ERROR', error: 'Invalid event envelope schema', details: validation.error.format() }))
        return
      }

      const eventPayload = validation.data

      // Fetch the latest session state to check if it has been ended
      let latestSession = null
      try {
        latestSession = await sessionService.getSessionById(sessionId)
      } catch (dbErr) {
        console.warn(`[ws-socket] Database connection failed while checking session status, bypassing ENDED check:`, dbErr.message)
      }

      if (latestSession && latestSession.status === 'ENDED') {
        try {
          await eventService.enqueueEvent(sessionId, eventPayload)
          ws.send(JSON.stringify({ event: 'ERROR', code: 'SESSION_ENDED', clientEventId: eventPayload.clientEventId, reason: 'Session already ended. Event stored as late.' }))
        } catch (enqueueErr) {
          console.error(`[ws-socket] failed to enqueue late event ${eventPayload.clientEventId}:`, enqueueErr)
        }
        ws.close(4005, 'Session already ended')
        return
      }

      if (eventPayload.type === 'HEARTBEAT') {
        // Heartbeat is processed directly and does not need BullMQ overhead
        try {
          await sessionService.updateHeartbeat(sessionId, CONNECTION_STATUS.CONNECTED, new Date())
          ws.send(JSON.stringify({ event: 'HEARTBEAT_ACK', sequenceNumber: eventPayload.sequenceNumber }))
        } catch (dbErr) {
          console.warn(`[ws-socket] Database connection failed while updating heartbeat, bypassing:`, dbErr.message)
          // Still respond to client that we received it
          ws.send(JSON.stringify({ event: 'HEARTBEAT_ACK', sequenceNumber: eventPayload.sequenceNumber }))
        }
      } else {
        // Idempotency: check if clientEventId is already in database
        let isDuplicate = false
        try {
          const dupRes = await db.query(
            'SELECT 1 FROM proctoring_events WHERE proctoring_session_id = $1 AND client_event_id = $2',
            [sessionId, eventPayload.clientEventId]
          )
          isDuplicate = dupRes.rows.length > 0
        } catch (dbErr) {
          console.warn(`[ws-socket] Database connection failed while checking duplicate event, bypassing:`, dbErr.message)
        }

        if (isDuplicate) {
          // Send duplicate ACK and ignore enqueuing
          console.log(`[ws-socket] duplicate event ${eventPayload.clientEventId} detected on socket. Sending duplicate ACK.`)
          ws.send(JSON.stringify({ event: 'ACK', clientEventId: eventPayload.clientEventId, sequenceNumber: eventPayload.sequenceNumber, duplicate: true }))
          return
        }

        // Enqueue browser events for BullMQ async processing with graceful queue error catching
        try {
          await eventService.enqueueEvent(sessionId, eventPayload)
          ws.send(JSON.stringify({ event: 'ACK', clientEventId: eventPayload.clientEventId, sequenceNumber: eventPayload.sequenceNumber }))
        } catch (enqueueErr) {
          console.error(`[ws-socket] failed to enqueue event ${eventPayload.clientEventId}:`, enqueueErr)
          ws.send(JSON.stringify({
            event: 'ERROR',
            code: 'PROCTORING_DEGRADED',
            clientEventId: eventPayload.clientEventId,
            reason: 'Queue unavailable'
          }))
        }
      }
    } catch (err) {
      console.error(`[ws-socket] error processing message on session ${sessionId}:`, err)
      ws.send(JSON.stringify({
        event: 'ERROR',
        code: 'PROCTORING_DEGRADED',
        reason: 'Service degraded'
      }))
    }
  })

  // Handle connection close
  ws.on('close', async (code, reason) => {
    clearInterval(healthCheckInterval)
    console.log(`[ws-socket] Session ${sessionId} connection closed. Code: ${code}, Reason: ${reason}`)

    // Remove from connection replacement registry
    if (activeConnections.get(sessionId) === ws) {
      activeConnections.delete(sessionId)
    }

    try {
      // Re-fetch session to make sure it wasn't ended via HTTP API
      const currentSession = await sessionService.getSessionById(sessionId)
      if (currentSession && currentSession.status !== 'ENDED') {
        await sessionService.updateHeartbeat(sessionId, CONNECTION_STATUS.DISCONNECTED)
      }
    } catch (err) {
      console.error(`[ws-socket] error on disconnect for session ${sessionId}:`, err)
    }
  })

  ws.on('error', (err) => {
    console.error(`[ws-socket] socket error on session ${sessionId}:`, err)
  })
}

module.exports = {
  handleProctoringConnection
}
