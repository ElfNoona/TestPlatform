'use strict'

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const env = require('../config/env')
const StorageAdapter = require('./storage.adapter')

class R2StorageAdapter extends StorageAdapter {
  constructor() {
    super()

    const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    const missing = required.filter(key => !env[key])
    if (missing.length > 0) {
      throw new Error(`CRITICAL CONFIGURATION ERROR: MEDIA_STORAGE_PROVIDER is set to 'r2' but the following required environment variables are missing: ${missing.join(', ')}`)
    }

    this.bucket = env.R2_BUCKET_NAME
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY
      }
    })
  }

  async getUploadUrl(key, mimeType, expiresIn) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType
    })
    return getSignedUrl(this.s3, command, { expiresIn })
  }

  async getDownloadUrl(key, expiresIn) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    })
    return getSignedUrl(this.s3, command, { expiresIn })
  }

  async deleteObject(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    })
    await this.s3.send(command)
  }

  async objectExists(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
      await this.s3.send(command)
      return true
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false
      }
      throw err
    }
  }
}

module.exports = R2StorageAdapter
