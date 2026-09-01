'use strict'

/**
 * grading-service/src/services/languages.js
 *
 * Maps language strings to Judge0 Extra CE language IDs.
 * Reference: https://ce.judge0.com/languages or the /languages endpoint of the extra instance.
 */

const LANGUAGE_IDS = {
  // Common IDs for Judge0 Extra CE
  'dart': 72,
  'python': 71,
  'javascript': 63,
  'java': 62,
  'cpp': 54,
  'c': 50,
  'rust': 73,
  'go': 60
}

function getJudge0LanguageId(languageString) {
  const id = LANGUAGE_IDS[languageString.toLowerCase()]
  if (!id) {
    throw new Error(`Unsupported language: ${languageString}`)
  }
  return id
}

module.exports = { getJudge0LanguageId }
