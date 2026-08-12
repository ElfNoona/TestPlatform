'use strict'

const { INCIDENT_SEVERITY, INCIDENT_STATUS } = require('../config/constants')

/**
 * Evaluates session counters and the latest event to detect if an incident should be triggered.
 *
 * @param {Object} session - The current proctoring session from DB
 * @param {Object} event - The proctoring event currently being processed
 * @returns {Object|null} The incident details to create, or null if no incident detected
 */
function evaluateIncidentRules(session, event) {
  const eventType = event.type
  const sessionId = session.id

  // Rule 2: Screen sharing stopped
  if (eventType === 'SCREEN_SHARE_STOPPED') {
    return {
      proctoring_session_id: sessionId,
      type: 'SCREEN_SHARE_INTERRUPTION',
      severity: INCIDENT_SEVERITY.HIGH,
      status: INCIDENT_STATUS.UNREVIEWED,
      started_at: event.client_timestamp,
      ended_at: null,
      event_count: 1,
      description: 'Candidate stopped sharing their screen.',
      metadata: JSON.stringify({ eventId: event.id })
    }
  }

  // Rule 3: Camera stopped or denied
  if (eventType === 'CAMERA_STOPPED') {
    return {
      proctoring_session_id: sessionId,
      type: 'CAMERA_INTERRUPTION',
      severity: INCIDENT_SEVERITY.HIGH,
      status: INCIDENT_STATUS.UNREVIEWED,
      started_at: event.client_timestamp,
      ended_at: null,
      event_count: 1,
      description: 'Candidate camera stream was stopped.',
      metadata: JSON.stringify({ eventId: event.id })
    }
  }

  if (eventType === 'CAMERA_PERMISSION_DENIED') {
    return {
      proctoring_session_id: sessionId,
      type: 'CAMERA_PERMISSION_DENIED',
      severity: INCIDENT_SEVERITY.CRITICAL,
      status: INCIDENT_STATUS.UNREVIEWED,
      started_at: event.client_timestamp,
      ended_at: null,
      event_count: 1,
      description: 'Camera access permission was denied.',
      metadata: JSON.stringify({ eventId: event.id })
    }
  }

  if (eventType === 'SCREEN_SHARE_PERMISSION_DENIED') {
    return {
      proctoring_session_id: sessionId,
      type: 'SCREEN_SHARE_PERMISSION_DENIED',
      severity: INCIDENT_SEVERITY.CRITICAL,
      status: INCIDENT_STATUS.UNREVIEWED,
      started_at: event.client_timestamp,
      ended_at: null,
      event_count: 1,
      description: 'Screen sharing permission was denied.',
      metadata: JSON.stringify({ eventId: event.id })
    }
  }

  // Rule 1: 3+ fullscreen exits
  if (eventType === 'FULLSCREEN_EXITED' && session.fullscreenExitCount >= 3) {
    return {
      proctoring_session_id: sessionId,
      type: 'FULLSCREEN_REPEATED',
      severity: INCIDENT_SEVERITY.HIGH,
      status: INCIDENT_STATUS.UNREVIEWED,
      started_at: event.client_timestamp,
      ended_at: null,
      event_count: session.fullscreenExitCount,
      description: `Repeated fullscreen exits detected (${session.fullscreenExitCount} exits).`,
      metadata: JSON.stringify({ exits: session.fullscreenExitCount })
    }
  }

  // Rule 4: 5+ tab switches
  if (eventType === 'TAB_HIDDEN' && session.tabSwitchCount >= 5) {
    return {
      proctoring_session_id: sessionId,
      type: 'EXCESSIVE_TAB_SWITCHING',
      severity: INCIDENT_SEVERITY.MEDIUM,
      status: INCIDENT_STATUS.UNREVIEWED,
      started_at: event.client_timestamp,
      ended_at: null,
      event_count: session.tabSwitchCount,
      description: `Candidate repeatedly switched tabs or minimized the browser (${session.tabSwitchCount} switches).`,
      metadata: JSON.stringify({ switches: session.tabSwitchCount })
    }
  }

  // Rule 5: Repeated copy/paste (e.g. total 5+ clipboard actions)
  const clipboardActions = session.copyCount + session.pasteCount
  if ((eventType === 'COPY' || eventType === 'PASTE') && clipboardActions >= 5) {
    return {
      proctoring_session_id: sessionId,
      type: 'EXCESSIVE_CLIPBOARD_ACTIVITY',
      severity: INCIDENT_SEVERITY.LOW,
      status: INCIDENT_STATUS.UNREVIEWED,
      started_at: event.client_timestamp,
      ended_at: null,
      event_count: clipboardActions,
      description: `Repeated clipboard activities detected (${clipboardActions} actions).`,
      metadata: JSON.stringify({ copy: session.copyCount, paste: session.pasteCount })
    }
  }

  return null
}

module.exports = {
  evaluateIncidentRules
}
