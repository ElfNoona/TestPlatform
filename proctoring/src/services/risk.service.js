'use strict'

const db = require('../db')
const { RISK_WEIGHTS, RISK_LEVELS, RISK_THRESHOLDS } = require('../config/constants')

class RiskService {
  /**
   * Recalculates risk score and risk level for a session and saves it to the DB.
   *
   * @param {string} sessionId - UUID of the session
   * @returns {Object} Updated session risk metrics
   */
  async calculateAndUpdateSessionRisk(sessionId) {
    // 1. Fetch current counters from DB
    const res = await db.query(
      `SELECT
        tab_switch_count,
        fullscreen_exit_count,
        copy_count,
        paste_count,
        camera_interruptions,
        screen_interruptions
       FROM proctoring_sessions
       WHERE id = $1`,
      [sessionId]
    )

    if (res.rows.length === 0) {
      throw new Error(`Session ${sessionId} not found for risk calculation`)
    }

    const s = res.rows[0]

    // 2. Compute risk score based on configured weights
    let score = 0
    score += (s.tab_switch_count || 0) * (RISK_WEIGHTS.TAB_HIDDEN || 0)
    score += (s.fullscreen_exit_count || 0) * (RISK_WEIGHTS.FULLSCREEN_EXITED || 0)
    score += (s.copy_count || 0) * (RISK_WEIGHTS.COPY || 0)
    score += (s.paste_count || 0) * (RISK_WEIGHTS.PASTE || 0)
    score += (s.camera_interruptions || 0) * (RISK_WEIGHTS.CAMERA_STOPPED || 0)
    score += (s.screen_interruptions || 0) * (RISK_WEIGHTS.SCREEN_SHARE_STOPPED || 0)

    // Repeated fullscreen exits: +5 additional points for each exit after the first
    if (s.fullscreen_exit_count && s.fullscreen_exit_count >= 2) {
      score += (s.fullscreen_exit_count - 1) * 5
    }

    // 3. Determine Risk Level
    let level = RISK_LEVELS.LOW
    if (score >= RISK_THRESHOLDS.CRITICAL) {
      level = RISK_LEVELS.CRITICAL
    } else if (score >= RISK_THRESHOLDS.HIGH) {
      level = RISK_LEVELS.HIGH
    } else if (score >= RISK_THRESHOLDS.MEDIUM) {
      level = RISK_LEVELS.MEDIUM
    }

    // 4. Update the session table
    const updateText = `
      UPDATE proctoring_sessions
      SET risk_score = $1, risk_level = $2, updated_at = now()
      WHERE id = $3
      RETURNING risk_score, risk_level;
    `
    const updateRes = await db.query(updateText, [score, level, sessionId])

    return {
      riskScore: updateRes.rows[0].risk_score,
      riskLevel: updateRes.rows[0].risk_level
    }
  }
}

module.exports = new RiskService()
