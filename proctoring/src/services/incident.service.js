'use strict'

const db = require('../db')
const { evaluateIncidentRules } = require('../rules/incident.rules')

class IncidentService {
  /**
   * Evaluates rules for the current event and session, and triggers an incident if matched.
   */
  async detectAndTriggerIncident(session, event) {
    const incidentData = evaluateIncidentRules(session, event)
    if (!incidentData) return null

    return this.createIncident(incidentData)
  }

  /**
   * Inserts or updates an incident.
   */
  async createIncident(data) {
    // Check if a similar incident of the same type is already open for this session (within last 2 minutes)
    // to group them together rather than creating spam.
    const duplicateRes = await db.query(
      `SELECT *
       FROM proctoring_incidents
       WHERE proctoring_session_id = $1
         AND type = $2
         AND status = 'UNREVIEWED'
         AND created_at > now() - INTERVAL '2 minutes'
       LIMIT 1`,
      [data.proctoring_session_id, data.type]
    )

    if (duplicateRes.rows.length > 0) {
      // Update existing open incident: increment count, update ended_at
      const inc = duplicateRes.rows[0]
      const updateText = `
        UPDATE proctoring_incidents
        SET
          event_count = event_count + 1,
          ended_at = $1,
          updated_at = now()
        WHERE id = $2
        RETURNING *;
      `
      const res = await db.query(updateText, [data.started_at, inc.id])
      return this._mapToCamelCase(res.rows[0])
    }

    // Otherwise insert new incident
    const insertText = `
      INSERT INTO proctoring_incidents (
        proctoring_session_id,
        type,
        severity,
        status,
        started_at,
        ended_at,
        event_count,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `
    const values = [
      data.proctoring_session_id,
      data.type,
      data.severity,
      data.status,
      data.started_at,
      data.ended_at,
      data.event_count,
      data.description,
      data.metadata
    ]

    const res = await db.query(insertText, values)
    return this._mapToCamelCase(res.rows[0])
  }

  /**
   * Retrieves all incidents for a session.
   */
  async getIncidentsBySessionId(sessionId) {
    const res = await db.query(
      'SELECT * FROM proctoring_incidents WHERE proctoring_session_id = $1 ORDER BY started_at ASC',
      [sessionId]
    )
    return res.rows.map(this._mapToCamelCase)
  }

  /**
   * Retrieves a single incident by ID.
   */
  async getIncidentById(id) {
    const res = await db.query('SELECT * FROM proctoring_incidents WHERE id = $1', [id])
    if (res.rows.length === 0) return null
    return this._mapToCamelCase(res.rows[0])
  }

  /**
   * Lists all incidents, supporting simple query filters (e.g. status, severity).
   */
  async listAllIncidents({ status, severity, sessionId } = {}) {
    let queryText = 'SELECT * FROM proctoring_incidents WHERE 1=1'
    const params = []

    if (status) {
      params.push(status)
      queryText += ` AND status = $${params.length}`
    }
    if (severity) {
      params.push(severity)
      queryText += ` AND severity = $${params.length}`
    }
    if (sessionId) {
      params.push(sessionId)
      queryText += ` AND proctoring_session_id = $${params.length}`
    }

    queryText += ' ORDER BY created_at DESC'

    const res = await db.query(queryText, params)
    return res.rows.map(this._mapToCamelCase)
  }

  _mapToCamelCase(row) {
    if (!row) return null
    return {
      id: row.id,
      sessionId: row.proctoring_session_id,
      type: row.type,
      severity: row.severity,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      eventCount: row.event_count,
      description: row.description,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

module.exports = new IncidentService()
