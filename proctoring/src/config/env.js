'use strict'

require('dotenv').config()

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PROCTORING_PORT || '7000', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://examuser:changeme@localhost:5432/examplatform',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY || 'dev-service-key'
}

module.exports = env
