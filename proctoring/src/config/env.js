'use strict'

require('dotenv').config()

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PROCTORING_PORT || '7000', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://examuser:changeme@localhost:5432/examplatform',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY || 'dev-service-key',
  
  MEDIA_STORAGE_PROVIDER: process.env.MEDIA_STORAGE_PROVIDER || 'local',
  // Cloudflare R2 credentials (MEDIA_STORAGE_PROVIDER=r2)
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || '',
  // AWS S3 credentials (MEDIA_STORAGE_PROVIDER=s3)
  AWS_REGION: process.env.AWS_REGION || 'ap-south-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
  AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME || '',
  MEDIA_MAX_SIZE_BYTES: parseInt(process.env.MEDIA_MAX_SIZE_BYTES || '262144', 10), // 250 KB default
  MEDIA_SNAPSHOT_INTERVAL_SECONDS: parseInt(process.env.MEDIA_SNAPSHOT_INTERVAL_SECONDS || '60', 10),
  MEDIA_CAPTURE_COOLDOWN_SECONDS: parseInt(process.env.MEDIA_CAPTURE_COOLDOWN_SECONDS || '5', 10),
  MEDIA_UPLOAD_URL_EXPIRY_SECONDS: parseInt(process.env.MEDIA_UPLOAD_URL_EXPIRY_SECONDS || '300', 10),
  MEDIA_RETENTION_DAYS: parseInt(process.env.MEDIA_RETENTION_DAYS || '30', 10) // 30 days retention
}

module.exports = env
