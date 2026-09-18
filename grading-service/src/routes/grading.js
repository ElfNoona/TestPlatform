'use strict'

const { Router } = require('express')
const router = Router()
const { executeCode } = require('../services/judge0')
const { getJudge0LanguageId } = require('../services/languages')

/**
 * POST /grade/execute — called by backend when student clicks "Run/Test Code"
 *
 * Body: { code, language, testCases: [{ stdin, expected_stdout }] }
 *
 * Returns Judge0 execution results for each test case.
 * DOES NOT save any grades to the database.
 */
router.post('/execute', async (req, res, next) => {
  try {
    const { code, language = 'dart', testCases = [] } = req.body
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' })
    }

    const langId = getJudge0LanguageId(language)
    const results = []

    // Execute test cases sequentially (for synchronous implementation)
    for (const tc of testCases) {
      try {
        const input = tc.stdin ?? tc.input ?? ''
        const expected = tc.expected_stdout ?? tc.expectedOutput ?? ''
        
        const result = await executeCode(code, langId, input, expected)
        results.push({
          stdin: input,
          expected_stdout: expected,
          stdout: result.stdout,
          stderr: result.stderr,
          compile_output: result.compile_output,
          status: result.status,
          time: result.time,
          memory: result.memory
        })
      } catch (err) {
        console.error('[grading-service/execute] Error executing test case:', err)
        results.push({
          stdin: tc.stdin ?? tc.input,
          error: 'Execution failed',
          details: err.message
        })
      }
    }

    res.json({ results })
  } catch (err) { next(err) }
})

module.exports = router
