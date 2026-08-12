'use strict'

const db = require('../db')
const { SESSION_STATUS, CONNECTION_STATUS } = require('../config/constants')

class SessionService {
  /**
   * Creates a new proctoring session.
   */
  async createSession({ assessmentSessionId, candidateId, assessmentId }) {
    const queryText = `
      INSERT INTO proctoring_sessions (
        attempt_id,
        student_id,
        assessment_id,
        status,
        connection_status
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (attempt_id) DO UPDATE SET
        updated_at = now()
      RETURNING *;
    `
    const values = [
      assessmentSessionId,
      candidateId,
      assessmentId,
      SESSION_STATUS.CREATED,
      CONNECTION_STATUS.DISCONNECTED
    ]

    const res = await db.query(queryText, values)
    return this._mapToCamelCase(res.rows[0])
  }

  /**
   * Fetches a session by its UUID.
   */
  async getSessionById(id) {
    const res = await db.query('SELECT * FROM proctoring_sessions WHERE id = $1', [id])
    if (res.rows.length === 0) return null
    return this._mapToCamelCase(res.rows[0])
  }

  /**
   * Fetches a session by its attempt (assessment session) UUID.
   */
  async getSessionByAttemptId(attemptId) {
    const res = await db.query('SELECT * FROM proctoring_sessions WHERE attempt_id = $1', [attemptId])
    if (res.rows.length === 0) return null
    return this._mapToCamelCase(res.rows[0])
  }

  /**
   * Updates session connection status and heartbeat timestamp.
   */
  async updateHeartbeat(id, connectionStatus, timestamp = new Date()) {
    const queryText = `
      UPDATE proctoring_sessions
      SET
        connection_status = $1,
        last_heartbeat_at = $2,
        status = CASE WHEN status = 'CREATED' THEN 'ACTIVE' ELSE status END,
        started_at = CASE WHEN started_at IS NULL THEN $2 ELSE started_at END,
        updated_at = now()
      WHERE id = $3
      RETURNING *;
    `
    const res = await db.query(queryText, [connectionStatus, timestamp, id])
    if (res.rows.length === 0) return null
    return this._mapToCamelCase(res.rows[0])
  }

  /**
   * Marks a session as ended, flushes statistics, and calculates final risk level.
   */
  async endSession(id) {
    // Enforce ACTIVE -> ENDED lifecycle. If already ended, return existing finalized record.
    const queryText = `
      UPDATE proctoring_sessions
      SET
        status = $1,
        connection_status = $2,
        ended_at = COALESCE(ended_at, now()),
        updated_at = now()
      WHERE (id = $3 OR attempt_id = $3) AND status != $1
      RETURNING *;
    `
    const res = await db.query(queryText, [
      SESSION_STATUS.ENDED,
      CONNECTION_STATUS.DISCONNECTED,
      id
    ])
    if (res.rows.length === 0) {
      // Fallback lookup for idempotency
      return (await this.getSessionById(id)) || (await this.getSessionByAttemptId(id))
    }
    return this._mapToCamelCase(res.rows[0])
  }

  /**
   * Generates a summary for the teacher review.
   */
  async getSessionSummary(id) {
    const session = (await this.getSessionById(id)) || (await this.getSessionByAttemptId(id))
    if (!session) return null

    const incidentsRes = await db.query(
      'SELECT COUNT(*) FROM proctoring_incidents WHERE proctoring_session_id = $1',
      [session.id]
    )

    const reviewRes = await db.query(
      `SELECT r.decision
       FROM proctoring_reviews r
       JOIN proctoring_incidents i ON r.incident_id = i.id
       WHERE i.proctoring_session_id = $1
       ORDER BY r.reviewed_at DESC LIMIT 1`,
      [session.id]
    )

    const reviewStatus = reviewRes.rows.length > 0 ? 'REVIEWED' : 'PENDING'

    // Compute sequence gaps dynamically at query time
    const seqsRes = await db.query(
      'SELECT sequence_number FROM proctoring_events WHERE proctoring_session_id = $1 ORDER BY sequence_number ASC',
      [session.id]
    )
    const sequences = seqsRes.rows.map(r => r.sequence_number)
    const missingSequences = []
    if (sequences.length > 0) {
      const maxSeq = Math.max(...sequences)
      const seqSet = new Set(sequences)
      for (let i = 1; i <= maxSeq; i++) {
        if (!seqSet.has(i)) {
          missingSequences.push(i)
        }
      }
    }

    return {
      sessionId: session.id,
      attemptId: session.attemptId,
      studentId: session.studentId,
      assessmentId: session.assessmentId,
      status: session.status,
      risk: {
        score: session.riskScore,
        level: session.riskLevel
      },
      events: {
        tabHidden: session.tabSwitchCount,
        fullscreenExit: session.fullscreenExitCount,
        copy: session.copyCount,
        paste: session.pasteCount,
        cameraInterruptions: session.cameraInterruptions,
        screenInterruptions: session.screenInterruptions
      },
      incidents: parseInt(incidentsRes.rows[0].count, 10),
      reviewStatus,
      sequenceGap: missingSequences.length > 0,
      missingSequences,
      expectedEventsCount: sequences.length > 0 ? Math.max(...sequences) : 0,
      receivedEventsCount: new Set(sequences).size
    }
  }

  /**
   * Generates aggregated admin metrics for an assessment.
   */
  async getAssessmentOverview(assessmentId) {
    const queryText = `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'ENDED' THEN 1 END) as completed,
        COUNT(CASE WHEN risk_level = 'LOW' THEN 1 END) as risk_low,
        COUNT(CASE WHEN risk_level = 'MEDIUM' THEN 1 END) as risk_medium,
        COUNT(CASE WHEN risk_level = 'HIGH' THEN 1 END) as risk_high,
        COUNT(CASE WHEN risk_level = 'CRITICAL' THEN 1 END) as risk_critical
      FROM proctoring_sessions
      WHERE assessment_id = $1;
    `
    const overviewRes = await db.query(queryText, [assessmentId])
    const row = overviewRes.rows[0]

    const incidentsRes = await db.query(
      `SELECT COUNT(*)
       FROM proctoring_incidents i
       JOIN proctoring_sessions s ON i.proctoring_session_id = s.id
       WHERE s.assessment_id = $1`,
      [assessmentId]
    )

    return {
      totalCandidates: parseInt(row.total || 0, 10),
      active: parseInt(row.active || 0, 10),
      completed: parseInt(row.completed || 0, 10),
      risk: {
        low: parseInt(row.risk_low || 0, 10),
        medium: parseInt(row.risk_medium || 0, 10),
        high: parseInt(row.risk_high || 0, 10),
        critical: parseInt(row.risk_critical || 0, 10)
      },
      incidents: parseInt(incidentsRes.rows[0].count || 0, 10)
    }
  }

  /**
   * Helper mapping snake_case keys from PG to camelCase.
   */
  _mapToCamelCase(row) {
    if (!row) return null
    return {
      id: row.id,
      attemptId: row.attempt_id,
      studentId: row.student_id,
      assessmentId: row.assessment_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      riskScore: row.risk_score,
      riskLevel: row.risk_level,
      tabSwitchCount: row.tab_switch_count,
      fullscreenExitCount: row.fullscreen_exit_count,
      copyCount: row.copy_count,
      pasteCount: row.paste_count,
      cameraInterruptions: row.camera_interruptions,
      screenInterruptions: row.screen_interruptions,
      lastHeartbeatAt: row.last_heartbeat_at,
      connectionStatus: row.connection_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

module.exports = new SessionService()
