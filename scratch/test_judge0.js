const { executeCode } = require('../grading-service/src/services/judge0')

async function run() {
  const code = 'void main() { print("Hello from TestPlatform"); }'
  
  console.log('Testing with matching expected_output (exact match):')
  const res1 = await executeCode(code, 90, '', 'Hello from TestPlatform\n')
  console.log('Status 1:', res1.status)
  
  console.log('Testing with matching expected_output (no newline):')
  const res2 = await executeCode(code, 90, '', 'Hello from TestPlatform')
  console.log('Status 2:', res2.status)
  
  console.log('Testing with empty expected_output:')
  const res3 = await executeCode(code, 90, '', '')
  console.log('Status 3:', res3.status)
}

run().catch(console.error)
