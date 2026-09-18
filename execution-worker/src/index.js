require('dotenv').config()
const { Worker } = require('bullmq')
const IORedis = require('ioredis')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const GRADING_SERVICE_URL = process.env.GRADING_SERVICE_URL || 'http://localhost:6000'
const CONCURRENCY = parseInt(process.env.CODE_EXECUTION_CONCURRENCY || '4', 10)

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null })

console.log(`[Worker] Starting Code Execution Worker...`)
console.log(`[Worker] Concurrency: ${CONCURRENCY}`)
console.log(`[Worker] Redis URL: ${REDIS_URL}`)
console.log(`[Worker] Grading Service URL: ${GRADING_SERVICE_URL}`)

const worker = new Worker(
  'code-execution',
  async (job) => {
    const { attemptId, questionId, code, language, testCases } = job.data

    console.log(`[Job ${job.id}] Executing code for Attempt: ${attemptId}, Question: ${questionId}`)

    // 1. Call grading service to execute code against Judge0
    const response = await fetch(`${GRADING_SERVICE_URL}/grade/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language, testCases })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[Job ${job.id}] Grading service failed: ${response.status} ${errText}`)
      // This throws an error to BullMQ, which triggers a retry according to the backoff policy
      throw new Error(`Execution proxy failed: ${response.status}`)
    }

    const data = await response.json()
    console.log(`[Job ${job.id}] Execution completed.`)

    // BullMQ automatically stores this returned value in Redis, which the frontend polls for.
    return data
  },
  {
    connection,
    concurrency: CONCURRENCY
  }
)

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully.`)
})

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} failed with error:`, err.message)
})

worker.on('error', (err) => {
  console.error(`[Worker] Internal BullMQ Error:`, err)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Worker] Shutting down...')
  await worker.close()
  connection.disconnect()
  process.exit(0)
})
