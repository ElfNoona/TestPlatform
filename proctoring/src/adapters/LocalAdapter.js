'use strict'

const fs   = require('fs')
const path = require('path')

/**
 * LocalAdapter — saves recordings to the local filesystem.
 * Used as the default fallback until a real cloud storage provider is wired up.
 *
 * Implements the StorageAdapter interface:
 *   save(attemptId, buffer, mimeType) → { location: string }
 *   status(attemptId)                 → { exists: boolean, location?: string }
 *
 * TODO: implement OciAdapter with the same interface (decisions.md #4)
 */
class LocalAdapter {
  constructor(uploadDir) {
    this.uploadDir = uploadDir
    fs.mkdirSync(uploadDir, { recursive: true })
  }

  async save(attemptId, buffer, mimeType) {
    const ext      = mimeType.split('/')[1] || 'webm'
    const filename = `${attemptId}.${ext}`
    const filepath = path.join(this.uploadDir, filename)
    fs.writeFileSync(filepath, buffer)
    return { location: filepath }
  }

  async status(attemptId) {
    // Check for any file matching the attemptId prefix
    const files = fs.readdirSync(this.uploadDir).filter((f) => f.startsWith(attemptId))
    if (files.length === 0) return { exists: false }
    return { exists: true, location: path.join(this.uploadDir, files[0]) }
  }
}

module.exports = LocalAdapter
