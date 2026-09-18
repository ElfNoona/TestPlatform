const request = require('supertest')
const express = require('express')

// Mock the Judge0 service so we don't need a real backend running
jest.mock('../grading-service/src/services/judge0', () => ({
  executeCode: jest.fn().mockResolvedValue({
    stdout: 'Hello from TestPlatform\n',
    stderr: '',
    compile_output: '',
    status: { id: 3, description: 'Accepted' },
    time: 0.1,
    memory: 1024
  })
}))

const { executeCode } = require('../grading-service/src/services/judge0')
const gradingRouter = require('../grading-service/src/routes/grading')

const app = express()
app.use(express.json())
app.use('/grade', gradingRouter)

describe('Grading Service Alias Normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('correctly maps input/expectedOutput properties to stdin/expected_stdout for Judge0', async () => {
    const res = await request(app)
      .post('/grade/execute')
      .send({
        code: 'void main() { print("Hello from TestPlatform"); }',
        language: 'dart',
        testCases: [
          {
            input: 'some stdin',
            expectedOutput: 'Hello from TestPlatform'
          }
        ]
      })

    expect(res.status).toBe(200)
    
    // Check that executeCode was called with the normalized values, NOT empty strings
    expect(executeCode).toHaveBeenCalledWith(
      'void main() { print("Hello from TestPlatform"); }',
      90, // Dart language ID mapped in getJudge0LanguageId
      'some stdin',
      'Hello from TestPlatform'
    )

    // Check that the response preserves the stdout output
    expect(res.body.results[0].expected_stdout).toBe('Hello from TestPlatform')
    expect(res.body.results[0].stdin).toBe('some stdin')
  })

  it('correctly maps legacy stdin/expected_stdout properties', async () => {
    const res = await request(app)
      .post('/grade/execute')
      .send({
        code: 'void main() {}',
        language: 'c',
        testCases: [
          {
            stdin: 'legacy stdin',
            expected_stdout: 'legacy expected'
          }
        ]
      })

    expect(res.status).toBe(200)
    
    expect(executeCode).toHaveBeenCalledWith(
      'void main() {}',
      50, // C language ID
      'legacy stdin',
      'legacy expected'
    )
  })
})
