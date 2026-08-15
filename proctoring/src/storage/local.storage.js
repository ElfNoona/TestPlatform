'use strict'

const fs = require('fs')
const path = require('path')
const env = require('../config/env')
const StorageAdapter = require('./storage.adapter')

class LocalStorageAdapter extends StorageAdapter {
  constructor(uploadDir) {
    super()
    this.uploadDir = uploadDir || path.join(__dirname, '..', '..', 'uploads', 'media')
    fs.mkdirSync(this.uploadDir, { recursive: true })
  }

  async getUploadUrl(key, mimeType, expiresIn) {
    // Return a local URL routing to our own service to receive the PUT file
    return `http://localhost:${env.PORT}/api/v1/media/local-upload?key=${encodeURIComponent(key)}`
  }

  async getDownloadUrl(key, expiresIn) {
    // Return a local URL routing to our own service to download the GET file
    return `http://localhost:${env.PORT}/api/v1/media/local-download?key=${encodeURIComponent(key)}`
  }

  async deleteObject(key) {
    const filepath = path.join(this.uploadDir, key)
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  }

  async objectExists(key) {
    const filepath = path.join(this.uploadDir, key)
    return fs.existsSync(filepath)
  }

  /**
   * Helper method to save buffer directly (specifically for local testing / mock routes)
   */
  async saveBuffer(key, buffer) {
    const filepath = path.join(this.uploadDir, key)
    fs.mkdirSync(path.dirname(filepath), { recursive: true })
    fs.writeFileSync(filepath, buffer)
    return filepath
  }

  /**
   * Helper method to read file buffer directly
   */
  async getBuffer(key) {
    const filepath = path.join(this.uploadDir, key)
    if (!fs.existsSync(filepath)) {
      throw new Error(`File not found: ${key}`)
    }
    return fs.readFileSync(filepath)
  }
}

module.exports = LocalStorageAdapter
