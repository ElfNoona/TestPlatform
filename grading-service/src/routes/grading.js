'use strict'

const { Router } = require('express')
const router = Router()
const { gradeMcq, gradeOutputPrediction, gradeWithAi } = require('../graders')

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
          return gradeWithAi(ans)
        default:
          return { questionId: ans.questionId, score: null, maxScore: 1, rationale: 'Unknown type', needsReview: true }
      }
    }))

    // TODO: save grades to DB
    res.json({ attemptId, grades })
  } catch (err) { next(err) }
})

module.exports = router
