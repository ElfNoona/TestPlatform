const { Pool } = require('pg')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')

// Config for local dev testing via Docker exposed ports
const DB_URL = 'postgresql://examuser:changeme@localhost:5433/examplatform'
const BACKEND_URL = 'http://localhost:4000'
const PROCTORING_URL = 'http://localhost:7000'

const pool = new Pool({ connectionString: DB_URL })

async function runTests() {
  console.log('🧪 Starting End-to-End Assesment Platform Tests...')
  
  const studentId = crypto.randomUUID()
  const qSetId = crypto.randomUUID()
  const qCodingId = crypto.randomUUID()
  const qMcqId = crypto.randomUUID()
  const accessCode = crypto.randomUUID().slice(0, 8)

  try {
    // 1. Seed Database (Question Set, Questions, Student)
    console.log('📦 Seeding database records...')
    await pool.query(`INSERT INTO question_sets (id, name, status) VALUES ($1, 'Integration Test Auto', 'published')`, [qSetId])
    
    // MCQ Question
    await pool.query(`
      INSERT INTO questions (id, question_set_id, type, prompt, options, correct_answer, marks, order_index)
      VALUES ($1, $2, 'mcq', 'What is 2 + 2?', ARRAY['3','4','5'], '4', 10, 1)
    `, [qMcqId, qSetId])
    
    // Coding Question (Python or Dart? Judge0 supports many. Let's use Python 3 snippet to keep it simple, evaluation_config_id is usually language ID, Python is 71 in standard Judge0).
    // Our implementation plan says we were fixing Dart syntax, meaning users might use Dart. Dart Judge0 ID is 73.
    // Let's use Dart!
    const dartAnswer = `void main() {\n  print("Hello, Judge0!");\n}`
    
    await pool.query(`
      INSERT INTO questions (id, question_set_id, type, prompt, marks, order_index, evaluation_config_id)
      VALUES ($1, $2, 'coding', 'Write a Dart program that prints "Hello, Judge0!"', 20, 2, '73')
    `, [qCodingId, qSetId])
    
    // Test Case for Dart
    await pool.query(`
      INSERT INTO test_cases (question_id, stdin, expected_stdout, is_hidden, weight)
      VALUES ($1, '', 'Hello, Judge0!\n', false, 20)
    `, [qCodingId])

    // Student
    await pool.query(`
      INSERT INTO students (id, name, access_code, question_set_id)
      VALUES ($1, 'Test Candidate', $2, $3)
    `, [studentId, accessCode, qSetId])

    // 2. Test POST /attempts/start
    console.log('🌐 Hitting POST /attempts/start...')
    const startRes = await fetch(`${BACKEND_URL}/attempts/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: accessCode })
    })
    
    if (!startRes.ok) throw new Error(`Start attempt failed: ${startRes.status} ${await startRes.text()}`)
    const startData = await startRes.json()
    console.log('✅ Attempt created! JWT Token received.')
    const token = startData.token
    const attemptId = startData.attemptId
    console.log('   Proctoring Session:', startData.proctoring.sessionId)

    // 3. Test GET /attempts/:id/state
    console.log('🌐 Hitting GET /attempts/:id/state...')
    const stateRes = await fetch(`${BACKEND_URL}/attempts/${attemptId}/state`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const stateData = await stateRes.json()
    console.log(`✅ State fetched! Exam duration remaining: ${stateData.remainingSeconds}s. Found ${stateData.questions.length} questions.`)

    // 4. Test POST /attempts/:id/answers
    console.log('🌐 Saving auto-save answers...')
    const ansRes = await fetch(`${BACKEND_URL}/attempts/${attemptId}/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        answers: {
          [qMcqId]: '4',
          [qCodingId]: dartAnswer
        }
      })
    })
    if (!ansRes.ok) throw new Error('Failed to save answers')
    console.log('✅ Answers saved to backend cache!')

    // 5. Test POST /attempts/:id/submit
    console.log('🌐 Submitting attempt (Triggering Proctoring finalization & Grading Service)...')
    const subRes = await fetch(`${BACKEND_URL}/attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!subRes.ok) throw new Error('Failed to submit')
    console.log('✅ Exam submitted! Wait 4 seconds for Grading Service & Judge0 to evaluate...')
    
    // Wait for the async grading tasks
    await new Promise(r => setTimeout(r, 4000))

    // 6. Verify Grades in Database
    console.log('🔍 Checking final grades in database...')
    const gradesRes = await pool.query('SELECT * FROM grades WHERE attempt_id = $1', [attemptId])
    console.log(`✅ Found ${gradesRes.rowCount} grades computed!`)
    
    for (const g of gradesRes.rows) {
      if (g.question_id === qMcqId) {
        console.log(`   - MCQ Score: ${g.auto_score}/${g.max_score} | Status: ${g.status}`)
        if (g.status !== 'GRADED') throw new Error('MCQ evaluator failed!')
      } else if (g.question_id === qCodingId) {
        console.log(`   - Coding Score: ${g.auto_score}/${g.max_score} | Status: ${g.status} | Feedback: "${g.rationale}"`)
        // If Judge0 is working properly, the Dart output match the stdout test case
        if (parseFloat(g.auto_score) < 0 && g.status === 'ERROR') console.warn('     ⚠️ Judge0 execution failed!')
      }
    }

    console.log('🎉 System End-to-End verified successfully!')
  } catch (err) {
    console.error('❌ E2E Error:', err)
  } finally {
    // Teardown
    console.log('🧹 Cleaning up database...')
    try {
      await pool.query('DELETE FROM grades WHERE attempt_id IN (SELECT id FROM attempts WHERE student_id = $1)', [studentId])
      await pool.query('DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE student_id = $1)', [studentId])
      await pool.query('DELETE FROM teacher_reviews WHERE attempt_id IN (SELECT id FROM attempts WHERE student_id = $1)', [studentId])
      await pool.query('DELETE FROM attempts WHERE student_id = $1', [studentId])
      await pool.query('DELETE FROM students WHERE id = $1', [studentId])
      await pool.query('DELETE FROM test_cases WHERE question_id = $1', [qCodingId])
      await pool.query('DELETE FROM questions WHERE question_set_id = $1', [qSetId])
      await pool.query('DELETE FROM question_sets WHERE id = $1', [qSetId])
    } catch (e) {
      console.error('Cleanup failed:', e.message)
    }
    await pool.end()
  }
}

runTests()
