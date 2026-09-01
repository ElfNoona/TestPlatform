const { Pool } = require('pg')
const http = require('http')

const pool = new Pool({
  connectionString: 'postgresql://examuser:changeme@postgres:5432/examplatform'
})

async function runTest() {
  console.log('Inserting mock data...')
  
  try {
    const qsetRes = await pool.query(`INSERT INTO question_sets (name, status) VALUES ('Test Exam', 'published') RETURNING id`)
    const qsetId = qsetRes.rows[0].id

    const qRes = await pool.query(`
      INSERT INTO questions (question_set_id, type, prompt, marks, evaluation_type, evaluation_config_id) 
      VALUES ($1, 'coding', 'Write a Dart function to add two numbers.', 10, 'compiler_tests', 'dart_eval_1') 
      RETURNING id
    `, [qsetId])
    const questionId = qRes.rows[0].id

    await pool.query(`INSERT INTO test_cases (question_id, stdin, expected_stdout, is_hidden, weight) VALUES ($1, '2 3', '5', false, 5)`, [questionId])
    await pool.query(`INSERT INTO test_cases (question_id, stdin, expected_stdout, is_hidden, weight) VALUES ($1, '-5 10', '5', true, 5)`, [questionId])

    const studentRes = await pool.query(`INSERT INTO students (name, access_code) VALUES ('Alice', 'ALICE' || extract(epoch from now())) RETURNING id`)
    const studentId = studentRes.rows[0].id

    const attemptRes = await pool.query(`INSERT INTO attempts (student_id) VALUES ($1) RETURNING id`, [studentId])
    const attemptId = attemptRes.rows[0].id

    console.log('Calling Grading Service API...')
    
    const answerText = `
import sys
line = sys.stdin.read().strip()
if line:
    a, b = map(int, line.split())
    print(a + b)
    `

    const payload = {
      attemptId: attemptId,
      answers: [
        {
          questionId: questionId,
          type: 'coding',
          answerText: answerText,
          evaluation: { language: 'python' }
        }
      ]
    }

    const options = {
      hostname: 'grading-service',
      port: 6000,
      path: '/grade',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', async () => {
        console.log('Grading API Response:', JSON.stringify(JSON.parse(data), null, 2))
        
        const gradeRes = await pool.query('SELECT * FROM grades WHERE attempt_id = $1', [attemptId])
        console.log('Grades Table contents:', JSON.stringify(gradeRes.rows, null, 2))
        await pool.end()
      })
    })

    req.on('error', e => {
      console.error(e)
      pool.end()
    })
    req.write(JSON.stringify(payload))
    req.end()

  } catch (e) {
    console.error(e)
    await pool.end()
  }
}

runTest()
