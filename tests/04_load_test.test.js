process.env.REDIS_URL = 'redis://localhost:6379/1'
process.env.JWT_SECRET = 'test-secret'
process.env.CODE_EXECUTION_CONCURRENCY = '4'

const request = require('supertest')
const jwt = require('jsonwebtoken')
const { Queue, Worker } = require('bullmq')
const IORedis = require('ioredis')
const express = require('express')

jest.mock('../backend/src/db', () => ({
  query: jest.fn()
}))

const db = require('../backend/src/db')
const app = require('../backend/src/index')
const { executionQueue, connection } = require('../backend/src/services/queue')

let worker
let connectionWorker
let mockServer
let mockPort

let maxConcurrentActive = 0
let currentActive = 0
let totalCompleted = 0
let totalFailed = 0

beforeAll(async () => {
  await connection.flushdb()

  const mockApp = express()
  mockApp.use(express.json())
  mockApp.post('/grade/execute', async (req, res) => {
    currentActive++
    if (currentActive > maxConcurrentActive) maxConcurrentActive = currentActive

    // Simulated Judge0 latency: 150-300ms
    const latency = Math.floor(Math.random() * 150) + 150
    await new Promise(r => setTimeout(r, latency))

    currentActive--
    res.json({ results: [] })
  })

  await new Promise(resolve => {
    mockServer = mockApp.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port
      resolve()
    })
  })

  connectionWorker = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  worker = new Worker('code-execution', async (job) => {
    const { code, language, testCases } = job.data
    const response = await fetch(`http://127.0.0.1:${mockPort}/grade/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language, testCases })
    })

    if (!response.ok) {
      throw new Error(`Execution proxy failed: ${response.status}`)
    }
    return response.json()
  }, { connection: connectionWorker, concurrency: 4 })

  worker.on('completed', () => totalCompleted++)
  worker.on('failed', () => totalFailed++)

  await worker.waitUntilReady()
})

afterAll(async () => {
  await worker.close()
  await executionQueue.close()
  await connectionWorker.quit()
  await connection.quit()
  if (mockServer) {
    mockServer.close()
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  maxConcurrentActive = 0
  currentActive = 0
  totalCompleted = 0
  totalFailed = 0
})

afterEach(async () => {
  await connection.flushdb()
})

describe('Load Test', () => {
  const attemptId = '11111111-1111-1111-1111-111111111111'
  const studentId = '22222222-2222-2222-2222-222222222222'
  const token = jwt.sign({ studentId, attemptId }, process.env.JWT_SECRET)

  test('9. 100-CONCURRENT-USER LOAD TEST', async () => {
    db.query.mockImplementation(() => {
      return Promise.resolve({ rows: [{ id: attemptId, student_id: studentId, submitted_at: null, stdin: '1', expected_stdout: '1' }] })
    })

    const startTime = Date.now()

    const reqPromises = []
    for (let i = 0; i < 100; i++) {
      reqPromises.push(
        request(app)
          .post(`/attempts/${attemptId}/run-code`)
          .set('Authorization', `Bearer ${token}`)
          .send({ questionId: `q${i}`, code: `print(${i});`, language: 'dart' })
      )
    }

    const responses = await Promise.all(reqPromises)
    const successResponses = responses.filter(r => r.status === 200)
    expect(successResponses.length).toBe(100)

    const apiLatency = Date.now() - startTime

    // Wait until queue drains
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for 100 jobs to complete')), 45000)
      const interval = setInterval(() => {
        if (totalCompleted + totalFailed === 100) {
          clearInterval(interval)
          clearTimeout(timeout)
          resolve()
        }
      }, 200)
    })

    const totalTime = Date.now() - startTime

    console.log(`
      --- 100-USER LOAD TEST RESULTS ---
      Total Requests: 100
      Successful API Enqueues: ${successResponses.length}
      API Latency for 100 requests: ${apiLatency}ms
      Max Concurrent Active Workers: ${maxConcurrentActive} (Expected <= 4)
      Total Jobs Completed: ${totalCompleted}
      Total Jobs Failed: ${totalFailed}
      Total Processing Time: ${totalTime}ms
    `)

    expect(maxConcurrentActive).toBeLessThanOrEqual(4)
    expect(totalCompleted).toBe(100)
    expect(totalFailed).toBe(0)
  }, 50000)
})
