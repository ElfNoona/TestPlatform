'use strict'

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const env = require('../config/env')
const StorageAdapter = require('./storage.adapter')

/**
 * S3StorageAdapter — AWS S3 storage adapter for proctoring media.
 *
 * Uses the standard AWS SDK v3 (already installed as @aws-sdk/client-s3).
 * Activated by setting: MEDIA_STORAGE_PROVIDER=s3
 *
 * Required environment variables:
 *   AWS_REGION            — e.g. 'ap-south-1' (Mumbai)
 *   AWS_ACCESS_KEY_ID     — IAM programmatic access key
 *   AWS_SECRET_ACCESS_KEY — IAM programmatic secret key
 *   AWS_S3_BUCKET_NAME    — Target bucket name (e.g. 'exam-proctoring-media')
 *
 * IAM policy required on the bucket (least-privilege):
 *   s3:PutObject, s3:GetObject, s3:DeleteObject, s3:HeadObject
 */
class S3StorageAdapter extends StorageAdapter {
  constructor() {
    super()

    const required = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME']
    const missing = required.filter(key => !env[key])
    if (missing.length > 0) {
      throw new Error(
        `CRITICAL CONFIGURATION ERROR: MEDIA_STORAGE_PROVIDER is set to 's3' but the following required environment variables are missing: ${missing.join(', ')}`
      )
    }

    this.bucket = env.AWS_S3_BUCKET_NAME
    this.s3 = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY
      }
    })
  }

  /**
   * Generates a short-lived presigned URL for a direct browser PUT upload.
   * @param {string} key      - Object key (e.g. 'sessions/<sessionId>/<mediaId>.jpg')
   * @param {string} mimeType - MIME type (e.g. 'image/jpeg')
   * @param {number} expiresIn - Expiry in seconds (default: 300 = 5 minutes)
   * @returns {Promise<string>} Presigned S3 PUT URL
   */
  async getUploadUrl(key, mimeType, expiresIn) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType
    })
    return getSignedUrl(this.s3, command, { expiresIn })
  }

  /**
   * Generates a short-lived presigned URL for teacher GET download.
   * @param {string} key      - Object key
   * @param {number} expiresIn - Expiry in seconds (default: 300 = 5 minutes)
   * @returns {Promise<string>} Presigned S3 GET URL
   */
  async getDownloadUrl(key, expiresIn) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    })
    return getSignedUrl(this.s3, command, { expiresIn })
  }

  /**
   * Deletes an object from S3. Safe to call on a key that does not exist.
   * S3 DeleteObject is idempotent — no error is thrown for missing keys.
   * @param {string} key - Object key
   */
  async deleteObject(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    })
    await this.s3.send(command)
  }

  /**
   * Checks whether an object exists in S3 using a lightweight HEAD request.
   * @param {string} key - Object key
   * @returns {Promise<boolean>}
   */
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

module.exports = S3StorageAdapter
