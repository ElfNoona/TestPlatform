process.env.JWT_SECRET = 'test-secret'

const request = require('supertest')
const jwt = require('jsonwebtoken')

jest.mock('../backend/src/db', () => ({
  query: jest.fn()
}))

const db = require('../backend/src/db')
const app = require('../backend/src/index')

describe('Timer and Auto-Submit API', () => {
  let token

  beforeAll(() => {
    token = jwt.sign({ studentId: 'student-123', role: 'student' }, process.env.JWT_SECRET)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should reject /answers when duration has expired', async () => {
    // Mock the DB to return an attempt that started 100 seconds ago, with a duration of 10 seconds.
    db.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'attempt-1',
          student_id: 'student-123',
          start_time: new Date(Date.now() - 100000).toISOString(),
          submitted_at: null,
          duration_seconds: 10
        }
      ]
    })
    
    // For the auto-submit query
    db.query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .post('/attempts/attempt-1/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: { 'q1': 'val' } })

    expect(res.status).toBe(403)
    expect(res.body.error).toContain('auto-submitted')
    
    // Verify the DB was called to auto-submit
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE attempts SET submitted_at = now()'),
      ['attempt-1']
    )
  })

  it('should reject /run-code when duration has expired', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'attempt-2',
          student_id: 'student-123',
          start_time: new Date(Date.now() - 50000).toISOString(),
          submitted_at: null,
          duration_seconds: 5
        }
      ]
    })
    
    db.query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .post('/attempts/attempt-2/run-code')
      .set('Authorization', `Bearer ${token}`)
      .send({ questionId: 'q2', code: 'print("hello")', language: 'python' })

    expect(res.status).toBe(403)
    expect(res.body.error).toContain('auto-submitted')
    
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE attempts SET submitted_at = now()'),
      ['attempt-2']
    )
  })

  it('should allow /answers when duration has not expired', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'attempt-3',
          student_id: 'student-123',
          start_time: new Date(Date.now() - 5000).toISOString(),
          submitted_at: null,
          duration_seconds: 120
        }
      ]
    })
    
    db.query.mockResolvedValueOnce({ rows: [] }) // Insert answers mock

    const res = await request(app)
      .post('/attempts/attempt-3/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: { 'q1': 'val' } })

    expect(res.status).toBe(200)
    
    // Verify insert answer was called, NOT update attempt
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO answers'),
      expect.any(Array)
    )
  })
})
