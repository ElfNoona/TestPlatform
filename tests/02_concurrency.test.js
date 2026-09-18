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

let activeFetchCalls = 0
let maxConcurrentFetches = 0

beforeAll(async () => {
  await connection.flushdb()

  const mockApp = express()
  mockApp.use(express.json())
  mockApp.post('/grade/execute', async (req, res) => {
    activeFetchCalls++
    if (activeFetchCalls > maxConcurrentFetches) {
      maxConcurrentFetches = activeFetchCalls
    }
    
    // simulate 500ms execution
    await new Promise(r => setTimeout(r, 500))
    
    activeFetchCalls--
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
  activeFetchCalls = 0
  maxConcurrentFetches = 0
})

afterEach(async () => {
  await connection.flushdb()
})

describe('Concurrency & FIFO Semantics', () => {
  const attemptId = '11111111-1111-1111-1111-111111111111'
  const studentId = '22222222-2222-2222-2222-222222222222'
  const token = jwt.sign({ studentId, attemptId }, process.env.JWT_SECRET)

  test('3. CONCURRENCY & 4. FIFO: 10 jobs execute with max concurrency 4', async () => {
    db.query.mockImplementation((query) => {
      if (query.includes('FROM attempts')) {
        return Promise.resolve({ rows: [{ id: attemptId, student_id: studentId, submitted_at: null }] })
      }
      if (query.includes('FROM test_cases')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    })

    const jobIds = []
    
    // Rapidly enqueue 10 jobs
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post(`/attempts/${attemptId}/run-code`)
        .set('Authorization', `Bearer ${token}`)
        .send({ questionId: `q${i}`, code: `print(${i});`, language: 'dart' })
      jobIds.push(res.body.jobId)
    }

    expect(jobIds.length).toBe(10)

    let completedCount = 0
    const completedIds = []
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for jobs to complete')), 15000)
      worker.on('completed', (job) => {
        completedCount++
        completedIds.push(job.id)
        if (completedCount === 10) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(maxConcurrentFetches).toBeLessThanOrEqual(4)
    expect(completedIds.slice(0, 4)).toEqual(expect.arrayContaining(jobIds.slice(0, 4)))
    expect(completedIds.slice(4, 8)).toEqual(expect.arrayContaining(jobIds.slice(4, 8)))
  }, 20000)
})
