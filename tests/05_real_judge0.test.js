process.env.REDIS_URL = 'redis://localhost:6379/1'
process.env.JWT_SECRET = 'test-secret'
process.env.CODE_EXECUTION_CONCURRENCY = '1'

const request = require('supertest')
const jwt = require('jsonwebtoken')
const { Worker } = require('bullmq')
const IORedis = require('ioredis')

jest.mock('../backend/src/db', () => ({
  query: jest.fn()
}))

const db = require('../backend/src/db')
const app = require('../backend/src/index')
const { executionQueue, connection } = require('../backend/src/services/queue')

let worker
let connectionWorker

// We will use the live grading service or directly hit the Tailscale IP if grading service is not running.
// Since grading service isn't mockable easily without starting it, let's start a mock grading service that forwards to the real Judge0.
const express = require('express')
let mockGradingServer
let mockGradingPort

beforeAll(async () => {
  await connection.flushdb()

  // Start a local grading service that forwards to the real Judge0 on Tailscale
  const mockApp = express()
  mockApp.use(express.json())
  mockApp.post('/grade/execute', async (req, res) => {
    const { code, language } = req.body
    
    const langMap = {
      'c': 50,
      'cpp': 54,
      'python': 71,
      'javascript': 63,
      'dart': 90
    }
    const language_id = langMap[language]
    if (!language_id) return res.status(400).json({ error: 'Unsupported lang' })
    
    try {
      const jRes = await fetch('http://100.121.157.94:2358/submissions?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_code: code, language_id })
      })
      const jData = await jRes.json()
      // Transform Judge0 response into what the frontend expects
      res.json({ results: [ { stdout: jData.stdout || jData.compile_output || '', status: jData.status } ] })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  await new Promise(resolve => {
    mockGradingServer = mockApp.listen(0, '127.0.0.1', () => {
      mockGradingPort = mockGradingServer.address().port
      resolve()
    })
  })

  connectionWorker = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  worker = new Worker('code-execution', async (job) => {
    const { code, language, testCases } = job.data
    const response = await fetch(`http://127.0.0.1:${mockGradingPort}/grade/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language, testCases })
    })

    if (!response.ok) throw new Error(`Execution proxy failed`)
    return response.json()
  }, { connection: connectionWorker, concurrency: 1 })

  await worker.waitUntilReady()
})

afterAll(async () => {
  await worker.close()
  await executionQueue.close()
  await connectionWorker.quit()
  await connection.quit()
  if (mockGradingServer) mockGradingServer.close()
})

afterEach(async () => {
  await connection.flushdb()
})

describe('Real Judge0 Integration on Tailscale IP', () => {
  const attemptId = '11111111-1111-1111-1111-111111111111'
  const studentId = '22222222-2222-2222-2222-222222222222'
  const token = jwt.sign({ studentId, attemptId }, process.env.JWT_SECRET)

  beforeEach(() => {
    db.query.mockImplementation((query) => {
      if (query.includes('FROM attempts')) {
        return Promise.resolve({ rows: [{ id: attemptId, student_id: studentId, submitted_at: null, start_time: new Date().toISOString(), duration_seconds: 7200 }] })
      }
      if (query.includes('FROM test_cases')) {
        return Promise.resolve({ rows: [{ stdin: '', expected_stdout: '' }] })
      }
      return Promise.resolve({ rows: [] })
    })
  })

  const runTest = async (language, code, expected) => {
    const res = await request(app)
      .post(`/attempts/${attemptId}/run-code`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionId: 'q1', code, language })

    expect(res.status).toBe(200)
    const jobId = res.body.jobId

    let result
    await new Promise((resolve) => {
      worker.on('completed', (job, ret) => {
        if (job.id === jobId) {
          result = ret
          resolve()
        }
      })
    })

    expect(result).toBeDefined()
    expect(result.results[0].stdout).toContain(expected)
  }

  test('Executes C', async () => {
    await runTest('c', '#include <stdio.h>\\nint main() { printf("Hello C"); return 0; }', 'Hello C')
  }, 10000)

  test('Executes C++', async () => {
    await runTest('cpp', '#include <iostream>\\nint main() { std::cout << "Hello C++"; return 0; }', 'Hello C++')
  }, 10000)

  test('Executes Python', async () => {
    await runTest('python', 'print("Hello Python")', 'Hello Python')
  }, 10000)

  test('Executes JavaScript', async () => {
    await runTest('javascript', 'console.log("Hello JS");', 'Hello JS')
  }, 10000)

  test('Executes Dart', async () => {
    await runTest('dart', 'void main() { print("Hello Dart"); }', 'Hello Dart')
  }, 10000)
})
