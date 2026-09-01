'use strict'

const db = require('../db')
const { executeCode } = require('../services/judge0')
const { getJudge0LanguageId } = require('../services/languages')
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

/**
 * Evaluates coding submissions against hidden/public test cases via Judge0.
 * @param {{ questionId, answerText, evaluation }} ans
 */
async function evaluateWithJudge0(ans) {
  try {
    // 1. Fetch test cases for this question
    const testCasesRes = await db.query(
      'SELECT stdin, expected_stdout, weight FROM test_cases WHERE question_id = $1',
      [ans.questionId]
    )
    const testCases = testCasesRes.rows

    if (testCases.length === 0) {
      return {
        questionId: ans.questionId,
        score: null,
        maxScore: 10, // Default if unknown
        rationale: 'No test cases found for this question. Needs manual review.',
        needsReview: true
      }
    }

    // 2. Resolve language ID (e.g. 'dart' -> 72)
    const languageStr = ans.evaluation?.language || 'dart'
    const langId = getJudge0LanguageId(languageStr)

    // 3. Execute all test cases sequentially (for synchronous implementation)
    let totalWeight = 0
    let earnedWeight = 0
    let passedCount = 0

    for (const tc of testCases) {
      totalWeight += (tc.weight || 1)
      
      const result = await executeCode(ans.answerText, langId, tc.stdin, tc.expected_stdout)
      console.log(`[Judge0] Result for TC:`, JSON.stringify(result, null, 2))
      
      // Judge0 status 3 = Accepted
      if (result.status && result.status.id === 3) {
        const output = (result.stdout || '').trim().replace(/\r\n/g, '\n')
        const expected = (tc.expected_stdout || '').trim().replace(/\r\n/g, '\n')
        
        if (output === expected) {
          earnedWeight += (tc.weight || 1)
          passedCount++
        }
      }
    }

    const maxPossibleScore = 10 // TODO: pull from questions table
    const calculatedScore = (earnedWeight / totalWeight) * maxPossibleScore

    return {
      questionId: ans.questionId,
      score: Number(calculatedScore.toFixed(2)),
      maxScore: maxPossibleScore,
      rationale: `Passed ${passedCount}/${testCases.length} test cases.`,
      needsReview: passedCount < testCases.length // Flag for partial credit AI/Teacher review if not perfect
    }
  } catch (err) {
    console.error('[judge0-evaluator]', err)
    return {
      questionId: ans.questionId,
      score: null,
      maxScore: 10,
      rationale: 'Execution engine error.',
      needsReview: true
    }
  }
}

module.exports = { gradeMcq, gradeOutputPrediction, gradeWithAi, evaluateWithJudge0 }
