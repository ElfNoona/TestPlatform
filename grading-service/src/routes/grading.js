'use strict'

const { Router } = require('express')
const router = Router()
const db = require('../db')
const { gradeMcq, gradeOutputPrediction, gradeWithAi, evaluateWithJudge0 } = require('../graders')

/**
 * POST /grade — called by backend after a student submits.
 *
 * Body: { attemptId, answers: [{ questionId, type, answerText, starterCode, correctAnswer }] }
 *
 * Returns: { grades: [{ questionId, score, maxScore, rationale, needsReview }] }
 *
 * MCQ + output-prediction are auto-graded synchronously.
 * coding + debug go to AI grader → always flagged needsReview=true until teacher confirms.
 *
 * TODO: persist grades to DB
 * TODO: handle AI provider errors gracefully (fallback to needsReview=true, score=null)
 */
router.post('/', async (req, res, next) => {
  try {
    const { attemptId, answers = [] } = req.body
    if (!attemptId) return res.status(400).json({ error: 'attemptId required' })

    const grades = await Promise.all(answers.map(async (ans) => {
      switch (ans.type) {
        case 'mcq':
          return gradeMcq(ans)
        case 'output-prediction':
          return gradeOutputPrediction(ans)
        case 'coding':
        case 'debug':
          return evaluateWithJudge0(ans)
        default:
          return { questionId: ans.questionId, score: null, maxScore: 1, rationale: 'Unknown type', needsReview: true }
      }
    }))

    // Save grades to DB
    for (const g of grades) {
      await db.query(
        `INSERT INTO grades (attempt_id, question_id, auto_score, max_score, status, rationale, evaluated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (attempt_id, question_id) 
         DO UPDATE SET 
            auto_score = EXCLUDED.auto_score, 
            max_score = EXCLUDED.max_score, 
            status = EXCLUDED.status, 
            rationale = EXCLUDED.rationale, 
            evaluated_at = EXCLUDED.evaluated_at`,
        [
          attemptId, 
          g.questionId, 
          g.score, 
          g.maxScore, 
          g.needsReview ? 'NEEDS_REVIEW' : 'GRADED', 
          g.rationale
        ]
      )
    }

    res.json({ attemptId, grades })
  } catch (err) { next(err) }
})

module.exports = router
