const { Pool } = require('pg')

const pool = new Pool({
  connectionString: 'postgresql://examuser:changeme@localhost:5432/examplatform'
})

async function runTest() {
  console.log('Inserting mock data...')
  
  try {
    // 1. Create a question set
    const qsetRes = await pool.query(`INSERT INTO question_sets (name, status) VALUES ('Test Exam', 'published') RETURNING id`)
    const qsetId = qsetRes.rows[0].id

    // 2. Create a coding question
    const qRes = await pool.query(`
      INSERT INTO questions (question_set_id, type, prompt, marks, evaluation_type, evaluation_config_id) 
      VALUES ($1, 'coding', 'Write a Dart function to add two numbers. Input is two integers separated by space. Output should be the sum.', 10, 'compiler_tests', 'dart_eval_1') 
      RETURNING id
    `, [qsetId])
    const questionId = qRes.rows[0].id

    // 3. Create test cases
    await pool.query(`INSERT INTO test_cases (question_id, stdin, expected_stdout, is_hidden, weight) VALUES ($1, '2 3', '5', false, 5)`, [questionId])
    await pool.query(`INSERT INTO test_cases (question_id, stdin, expected_stdout, is_hidden, weight) VALUES ($1, '-5 10', '5', true, 5)`, [questionId])

    // 4. Create a student
    const studentRes = await pool.query(`INSERT INTO students (name, access_code) VALUES ('Alice', 'ALICE123') RETURNING id`)
    const studentId = studentRes.rows[0].id

    // 5. Create an attempt
    const attemptRes = await pool.query(`INSERT INTO attempts (student_id) VALUES ($1) RETURNING id`, [studentId])
    const attemptId = attemptRes.rows[0].id

    // 6. Call the grading service
    console.log('Calling Grading Service API...')
    
    // Dart code to add two numbers
    const answerText = `
import 'dart:io';
void main() {
  var line = stdin.readLineSync();
  if (line != null) {
    var parts = line.split(' ');
    var a = int.parse(parts[0]);
    var b = int.parse(parts[1]);
    print(a + b);
  }
}
    `

    const payload = {
      attemptId: attemptId,
      answers: [
        {
          questionId: questionId,
          type: 'coding',
          answerText: answerText,
          evaluation: { language: 'dart' }
        }
      ]
    }

    const response = await fetch('http://localhost:6000/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const data = await response.json()
    console.log('Grading API Response:', JSON.stringify(data, null, 2))

    // 7. Verify DB
    const gradeRes = await pool.query('SELECT * FROM grades WHERE attempt_id = $1', [attemptId])
    console.log('Grades Table contents:', JSON.stringify(gradeRes.rows, null, 2))

  } catch (e) {
    console.error(e)
  } finally {
    await pool.end()
  }
}

runTest()
