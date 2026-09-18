process.env.REDIS_URL = 'redis://localhost:6379/1'
process.env.JWT_SECRET = 'test-secret'
process.env.CODE_EXECUTION_CONCURRENCY = '4'

const request = require('supertest')
const jwt = require('jsonwebtoken')
const { Queue, Worker } = require('bullmq')
const IORedis = require('ioredis')

jest.mock('../backend/src/db', () => ({
  query: jest.fn()
}))

const db = require('../backend/src/db')
const app = require('../backend/src/index')
const { executionQueue, connection } = require('../backend/src/services/queue')

const express = require('express')
let mockServer
let mockServerState = {
  status: 200,
  latency: 0
}

beforeAll(async () => {
  await connection.flushdb()

  // Start mock grading service
  const mockApp = express()
  mockApp.use(express.json())
  mockApp.post('/grade/execute', async (req, res) => {
    if (mockServerState.latency) {
      await new Promise(r => setTimeout(r, mockServerState.latency))
    }
    if (mockServerState.status !== 200) {
      return res.status(mockServerState.status).send('Error')
    }
    res.json({ results: [{ status: { id: 3, description: 'Accepted' } }] })
  })

  let mockPort
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
  mockServerState = { status: 200, latency: 0 }
})

afterEach(async () => {
  await executionQueue.obliterate({ force: true }).catch(() => {})
})

describe('BullMQ Queue and Worker Architecture', () => {
  const attemptId = '11111111-1111-1111-1111-111111111111'
  const studentId = '22222222-2222-2222-2222-222222222222'
  const token = jwt.sign({ studentId, attemptId }, process.env.JWT_SECRET)

  test('1. QUEUE / JOB CREATION: Valid request creates one BullMQ job', async () => {
    db.query.mockImplementation((query) => {
      if (query.includes('FROM attempts')) {
        return Promise.resolve({ rows: [{ id: attemptId, student_id: studentId, submitted_at: null }] })
      }
      if (query.includes('FROM test_cases')) {
        return Promise.resolve({ rows: [{ stdin: '1', expected_stdout: '1' }] })
      }
      return Promise.resolve({ rows: [] })
    })

    const res = await request(app)
      .post(`/attempts/${attemptId}/run-code`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionId: 'q1', code: 'print("hello");', language: 'dart' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('jobId')

    const jobId = res.body.jobId
    const job = await executionQueue.getJob(jobId)
    expect(job).not.toBeNull()
    expect(job.data).toMatchObject({
      attemptId,
      questionId: 'q1',
      code: 'print("hello");',
      language: 'dart',
      testCases: [{ stdin: '1', expected_stdout: '1' }]
    })
  })

  test('2. WORKER EXECUTION: Worker consumes job and completes it successfully', async () => {
    db.query.mockImplementation((query) => {
      if (query.includes('FROM attempts')) {
        return Promise.resolve({ rows: [{ id: attemptId, student_id: studentId, submitted_at: null }] })
      }
      if (query.includes('FROM test_cases')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    })

    const res = await request(app)
      .post(`/attempts/${attemptId}/run-code`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionId: 'q1', code: 'print("hello");', language: 'dart' })

    const jobId = res.body.jobId
    console.log('Enqueued job ID from API:', jobId)

    // Wait for job to complete
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for job completion')), 4000)
      worker.on('active', (job) => console.log('Job active:', job.id))
      worker.on('failed', (job, err) => {
        console.log('Job failed:', job.id, err.message)
        if (job.id === jobId) {
          clearTimeout(timeout)
          reject(new Error('Job failed instead of completing: ' + err.message))
        }
      })
      worker.on('completed', (job) => {
        console.log('Job completed:', job.id)
        if (job.id === jobId) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })


    
    // Check status API
    const statusRes = await request(app)
      .get(`/attempts/${attemptId}/run-code/${jobId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(statusRes.status).toBe(200)
    expect(statusRes.body.status).toBe('completed')
    expect(statusRes.body.result).toEqual({ results: [{ status: { id: 3, description: 'Accepted' } }] })
  })

  test('5. FAILURE SEMANTICS: Network error causes retry (failed proxy)', async () => {
    db.query.mockImplementation((query) => {
      if (query.includes('FROM attempts')) {
        return Promise.resolve({ rows: [{ id: attemptId, student_id: studentId, submitted_at: null }] })
      }
      if (query.includes('FROM test_cases')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    })
    
    mockServerState.status = 500

    const res = await request(app)
      .post(`/attempts/${attemptId}/run-code`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionId: 'q1', code: 'print("hello");', language: 'dart' })

    const jobId = res.body.jobId
    console.log('Enqueued job ID from API for Test 5:', jobId)

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for job failure')), 4000)
      worker.on('active', (job) => console.log('Job active (T5):', job.id))
      worker.on('failed', (job, err) => {
        console.log('Job failed (T5):', job.id, err.message)
        if (job.id === jobId) {
          clearTimeout(timeout)
          resolve()
        }
      })
      worker.on('completed', (job) => {
        console.log('Job completed (T5):', job.id)
        if (job.id === jobId) {
          clearTimeout(timeout)
          reject(new Error('Job completed instead of failing'))
        }
      })
    })

    const statusRes = await request(app)
      .get(`/attempts/${attemptId}/run-code/${jobId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(statusRes.status).toBe(200)
    expect(statusRes.body.status).toBe('failed')
    expect(statusRes.body.error).toContain('Execution proxy failed: 500')
  })

  test('8. NO GRADING SIDE EFFECTS: Run code never updates grades or submissions', async () => {
    db.query.mockImplementation((query) => {
      if (query.includes('FROM attempts')) {
        return Promise.resolve({ rows: [{ id: attemptId, student_id: studentId, submitted_at: null }] })
      }
      if (query.includes('FROM test_cases')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    })

    const res = await request(app)
      .post(`/attempts/${attemptId}/run-code`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionId: 'q1', code: 'print("hello");', language: 'dart' })
      
    // Assert db.query was NEVER called with an UPDATE statement
    const updateCalls = db.query.mock.calls.filter(call => call[0].toUpperCase().includes('UPDATE'))
    expect(updateCalls.length).toBe(0)
    
    // Assert db.query was NEVER called with an INSERT into grades or answers
    const insertCalls = db.query.mock.calls.filter(call => call[0].toUpperCase().includes('INSERT'))
    expect(insertCalls.length).toBe(0)
  })
})
