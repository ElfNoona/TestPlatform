const { Queue } = require('bullmq')
const IORedis = require('ioredis')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null })

const executionQueue = new Queue('code-execution', { connection })

module.exports = {
  executionQueue,
  connection
}
