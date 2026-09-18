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

beforeAll(async () => {
  await connection.flushdb()

  const mockApp = express()
  mockApp.use(express.json())
  mockApp.post('/grade/execute', async (req, res) => {
    // simulate random latency
    await new Promise(r => setTimeout(r, Math.random() * 100 + 50))
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
})

afterEach(async () => {
  await connection.flushdb()
})

describe('Rapid Runs / Anti-Stale', () => {
  const attemptId = '11111111-1111-1111-1111-111111111111'
  const studentId = '22222222-2222-2222-2222-222222222222'
  const token = jwt.sign({ studentId, attemptId }, process.env.JWT_SECRET)

  test('7. RAPID / DUPLICATE RUNS: Multiple jobs do not corrupt each other', async () => {
    db.query.mockImplementation((query) => {
      if (query.includes('FROM attempts')) {
        return Promise.resolve({ rows: [{ id: attemptId, student_id: studentId, submitted_at: null }] })
      }
      if (query.includes('FROM test_cases')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    })

    // Fire 5 rapid requests for the same attempt/question
    const reqPromises = []
    for (let i = 0; i < 5; i++) {
      reqPromises.push(
        request(app)
          .post(`/attempts/${attemptId}/run-code`)
          .set('Authorization', `Bearer ${token}`)
          .send({ questionId: 'q1', code: `print(${i});`, language: 'dart' })
      )
    }

    const responses = await Promise.all(reqPromises)
    
    // Check they all returned unique jobIds
    const jobIds = responses.map(res => res.body.jobId)
    const uniqueJobIds = new Set(jobIds)
    expect(uniqueJobIds.size).toBe(5)

    let completedCount = 0
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for jobs to complete')), 10000)
      worker.on('completed', () => {
        completedCount++
        if (completedCount === 5) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    // Assert the backend status API can safely fetch each one individually
    for (const jid of jobIds) {
      const st = await request(app)
        .get(`/attempts/${attemptId}/run-code/${jid}`)
        .set('Authorization', `Bearer ${token}`)
      expect(st.status).toBe(200)
      expect(st.body.status).toBe('completed')
    }
  }, 15000)
})
