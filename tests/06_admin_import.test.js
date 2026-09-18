process.env.JWT_SECRET = 'test-secret'

const request = require('supertest')
const jwt = require('jsonwebtoken')
const XLSX = require('xlsx')

jest.mock('../backend/src/db', () => ({
  query: jest.fn()
}))

const db = require('../backend/src/db')
const app = require('../backend/src/index')

describe('Admin Student Spreadsheet Import API', () => {
  let token

  beforeAll(() => {
    token = jwt.sign({ role: 'teacher' }, process.env.JWT_SECRET)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  const generateBuffer = (data, format = 'csv') => {
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    return XLSX.write(wb, { type: 'buffer', bookType: format })
  }

  it('A. Valid XLSX import', async () => {
    const data = [
      { name: 'Alice', access_code: 'A123', slot_id: 'morning', question_set_id: 'qset-1' }
    ]
    const buffer = generateBuffer(data, 'xlsx')

    db.query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'students.xlsx')

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.inserted).toBe(1)
    expect(res.body.failed).toBe(0)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO students'),
      ['Alice', 'A123', 'morning', 'qset-1']
    )
  })

  it('B. Valid CSV import', async () => {
    const data = [
      { name: 'Bob', access_code: 'B123', slot_id: 'afternoon', question_set_id: 'qset-2' }
    ]
    const buffer = generateBuffer(data, 'csv')

    db.query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'students.csv')

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.inserted).toBe(1)
    expect(res.body.failed).toBe(0)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO students'),
      ['Bob', 'B123', 'afternoon', 'qset-2']
    )
  })

  it('C. Missing name rejects row', async () => {
    const data = [{ access_code: 'C123' }]
    const buffer = generateBuffer(data, 'csv')

    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'students.csv')

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.inserted).toBe(0)
    expect(res.body.failed).toBe(1)
    expect(res.body.errors[0].error).toContain('missing name or access_code')
    expect(db.query).not.toHaveBeenCalled()
  })

  it('D. Missing access_code rejects row', async () => {
    const data = [{ name: 'Dave' }]
    const buffer = generateBuffer(data, 'csv')

    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'students.csv')

    expect(res.status).toBe(200)
    expect(res.body.failed).toBe(1)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('E. Invalid question_set_id / database failure', async () => {
    const data = [{ name: 'Eve', access_code: 'E123' }]
    const buffer = generateBuffer(data, 'csv')

    db.query.mockRejectedValueOnce(new Error('foreign key constraint violation'))

    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'students.csv')

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.inserted).toBe(0)
    expect(res.body.failed).toBe(1)
    expect(res.body.errors[0].error).toContain('foreign key constraint violation')
  })

  it('F. Duplicate access_code updates the existing student (upsert syntax)', async () => {
    const data = [{ name: 'Frank', access_code: 'F123' }]
    const buffer = generateBuffer(data, 'csv')

    db.query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'students.csv')

    expect(res.status).toBe(200)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (access_code) DO UPDATE SET'),
      expect.any(Array)
    )
  })

  it('G. A failed row does NOT prevent subsequent valid rows from being imported', async () => {
    const data = [
      { name: 'Grace', access_code: 'G123' }, // will fail DB
      { access_code: 'H123' },                // will fail validation
      { name: 'Ivy', access_code: 'I123' }    // will succeed
    ]
    const buffer = generateBuffer(data, 'csv')

    // First DB call rejects, second DB call succeeds
    db.query.mockRejectedValueOnce(new Error('db error'))
    db.query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'students.csv')

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(3)
    expect(res.body.inserted).toBe(1)
    expect(res.body.failed).toBe(2)
    expect(db.query).toHaveBeenCalledTimes(2) // Grace, Ivy
  })

  it('H. Unauthenticated/unauthorized request is rejected', async () => {
    const buffer = generateBuffer([{ name: 'J', access_code: 'J1' }], 'csv')
    const res = await request(app)
      .post('/admin/students/upload')
      .attach('file', buffer, 'students.csv')

    expect(res.status).toBe(401)
  })

  it('I. Missing file is rejected', async () => {
    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Missing file')
  })

  it('J. Unsupported file type is rejected', async () => {
    const buffer = Buffer.from('just a random text file')
    const res = await request(app)
      .post('/admin/students/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'students.txt')

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Unsupported file type')
  })
})
