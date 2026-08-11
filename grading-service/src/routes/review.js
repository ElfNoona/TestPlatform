'use strict'

const { Router } = require('express')
const router = Router()

/**
 * routes/review.js — teacher review and override API.
 *
 * GET  /review/attempts/:attemptId    — list all grades for an attempt (teacher only)
 * POST /review/grades/:gradeId/override — override a grade with teacher score + comment
 *
 * TODO: add teacher auth middleware (awaiting provider decision — decisions.md #1)
 * TODO: grading review UI is not yet scoped (decisions.md #2)
 */

router.get('/attempts/:attemptId', async (req, res, next) => {
  try {
    // TODO: require teacher auth
    // TODO: SELECT grades FROM db WHERE attempt_id = req.params.attemptId
    res.json({ grades: [], message: 'TODO: not yet implemented' })
  } catch (err) { next(err) }
})

router.post('/grades/:gradeId/override', async (req, res, next) => {
  try {
    // TODO: require teacher auth
    const { score, comment } = req.body
    // TODO: UPDATE grade SET score=$1, teacher_comment=$2, reviewed_at=now() WHERE id=$3
    res.json({ overridden: true, message: 'TODO: not yet implemented' })
  } catch (err) { next(err) }
})

module.exports = router
