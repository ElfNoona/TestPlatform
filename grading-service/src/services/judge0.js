'use strict'

/**
 * grading-service/src/services/judge0.js
 *
 * Client for the Judge0 API.
 */

const JUDGE0_API_URL = process.env.JUDGE0_API_URL || 'http://localhost:2358'

/**
 * Submits code to Judge0 for execution and waits for the result.
 * 
 * @param {string} sourceCode The full code to execute (including tests)
 * @param {number} languageId The Judge0 language ID (e.g. 72 for Dart, or 93 for Dart in Judge0 Extra)
 * @param {string} stdin Optional standard input
 * @param {string} expectedOutput Optional expected output for Judge0 to compare
 */
async function executeCode(sourceCode, languageId, stdin = '', expectedOutput = '') {
  try {
    // 1. Submit the code (wait=true for synchronous response up to a certain timeout)
    const response = await fetch(`${JUDGE0_API_URL}/submissions?base64_encoded=false&wait=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_code: sourceCode,
        language_id: languageId,
        stdin: stdin,
        expected_output: expectedOutput,
      }),
    })

    if (!response.ok) {
      throw new Error(`Judge0 API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (err) {
    console.error('[judge0-service]', err)
    throw err
  }
}

module.exports = { executeCode }
