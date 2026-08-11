'use strict'

/**
 * graders/index.js — grading logic.
 *
 * gradeMcq             — exact answer-key match
 * gradeOutputPrediction — trimmed exact match (normalise newlines)
 * gradeWithAi          — AI-suggested score for coding/debug questions
 *
 * TODO: implement gradeWithAi using chosen AI provider (decisions.md)
 * TODO: define maxScore per question type (currently hardcoded to 1)
 */

/**
 * @param {{ questionId, correctAnswer, answerText }} ans
 */
function gradeMcq(ans) {
  const correct = (ans.answerText?.trim() ?? '') === (ans.correctAnswer?.trim() ?? '')
  return {
    questionId:  ans.questionId,
    score:       correct ? 1 : 0,
    maxScore:    1,
    rationale:   correct ? 'Correct' : `Expected: ${ans.correctAnswer}`,
    needsReview: false,
  }
}

/**
 * @param {{ questionId, correctAnswer, answerText }} ans
 */
function gradeOutputPrediction(ans) {
  const normalise = (s) => (s ?? '').trim().replace(/\r\n/g, '\n')
  const correct = normalise(ans.answerText) === normalise(ans.correctAnswer)
  return {
    questionId:  ans.questionId,
    score:       correct ? 1 : 0,
    maxScore:    1,
    rationale:   correct ? 'Exact match' : 'Output did not match expected',
    needsReview: false,
  }
}

/**
 * AI grader — always returns needsReview=true until teacher confirms.
 * @param {{ questionId, answerText, starterCode, prompt }} ans
 */
async function gradeWithAi(ans) {
  // TODO: call AI provider API
  // Example structure for OpenAI:
  //   const completion = await openai.chat.completions.create({ ... })
  //   const { score, rationale } = parseAiResponse(completion)
  //
  // For now return a stub so the service boots cleanly
  return {
    questionId:  ans.questionId,
    score:       null,  // null = not yet graded
    maxScore:    10,    // TODO: pull from question definition
    rationale:   'AI grading not yet implemented — awaiting provider decision',
    needsReview: true,
  }
}

module.exports = { gradeMcq, gradeOutputPrediction, gradeWithAi }
