'use strict'

const db = require('../db')
const { INCIDENT_STATUS } = require('../config/constants')

class ReviewService {
  /**
   * Records a teacher review/decision for an incident and marks the incident as REVIEWED.
   */
  async createReview({ incidentId, teacherId, decision, comment }) {
    // Start transaction to keep incident status and review insertion consistent
    const client = await db.pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Insert review row
      const insertReviewText = `
        INSERT INTO proctoring_reviews (
          incident_id,
          teacher_id,
          decision,
          comment
        ) VALUES ($1, $2, $3, $4)
        RETURNING *;
      `
      const reviewRes = await client.query(insertReviewText, [
        incidentId,
        teacherId,
        decision,
        comment || null
      ])

      // 2. Update incident status
      const updateIncidentText = `
        UPDATE proctoring_incidents
        SET status = $1, updated_at = now()
        WHERE id = $2
        RETURNING *;
      `
      await client.query(updateIncidentText, [INCIDENT_STATUS.REVIEWED, incidentId])

      await client.query('COMMIT')

      const row = reviewRes.rows[0]
      return {
        id: row.id,
        incidentId: row.incident_id,
        teacherId: row.teacher_id,
        decision: row.decision,
        comment: row.comment,
        reviewedAt: row.reviewed_at
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Fetches review history for an incident.
   */
  async getReviewsForIncident(incidentId) {
    const res = await db.query(
      'SELECT * FROM proctoring_reviews WHERE incident_id = $1 ORDER BY reviewed_at DESC',
      [incidentId]
    )

    return res.rows.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      teacherId: row.teacher_id,
      decision: row.decision,
      comment: row.comment,
      reviewedAt: row.reviewed_at
    }))
  }

  /**
   * Records a teacher/admin overall integrity review for a session (Append-Only).
   */
  async createSessionReview({ sessionId, teacherId, decision, comment }) {
    const queryText = `
      INSERT INTO proctoring_session_reviews (
        proctoring_session_id,
        teacher_id,
        decision,
        comment
      ) VALUES ($1, $2, $3, $4)
      RETURNING *;
    `
    const res = await db.query(queryText, [sessionId, teacherId, decision, comment || null])
    const row = res.rows[0]
    return {
      id: row.id,
      sessionId: row.proctoring_session_id,
      teacherId: row.teacher_id,
      decision: row.decision,
      comment: row.comment,
      reviewedAt: row.reviewed_at
    }
  }

  /**
   * Fetches overall integrity review history for a session (ordered by reviewed_at DESC).
   */
  async getSessionReviews(sessionId) {
    const res = await db.query(
      'SELECT * FROM proctoring_session_reviews WHERE proctoring_session_id = $1 ORDER BY reviewed_at DESC',
      [sessionId]
    )
    return res.rows.map((row) => ({
      id: row.id,
      sessionId: row.proctoring_session_id,
      teacherId: row.teacher_id,
      decision: row.decision,
      comment: row.comment,
      reviewedAt: row.reviewed_at
    }))
  }
}

module.exports = new ReviewService()
