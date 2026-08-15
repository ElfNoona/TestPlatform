'use strict'

const db = require('../db')
const env = require('../config/env')
const { MEDIA_STATES } = require('../config/constants')
const LocalStorageAdapter = require('../storage/local.storage')
const R2StorageAdapter = require('../storage/r2.storage')
const { v4: uuidv4 } = require('uuid')

// Instantiate storage adapter based on environment variable
let storageAdapter
if (env.MEDIA_STORAGE_PROVIDER === 'r2') {
  storageAdapter = new R2StorageAdapter()
} else {
  // Default to local storage simulator
  storageAdapter = new LocalStorageAdapter()
}

class MediaService {
  constructor() {
    this.storageAdapter = storageAdapter
  }

  /**
   * Registers media upload intent and generates presigned URL.
   */
  async requestUploadUrl({ sessionId, mediaType, mimeType, sizeBytes, clientEventId, capturedAt }) {
    // 1. Verify session exists
    const sessionRes = await db.query('SELECT id FROM proctoring_sessions WHERE id = $1', [sessionId])
    if (sessionRes.rows.length === 0) {
      throw new Error('Proctoring session not found')
    }

    // 2. Resolve event database UUID if clientEventId is provided
    let eventId = null
    if (clientEventId) {
      const eventRes = await db.query(
        'SELECT id FROM proctoring_events WHERE proctoring_session_id = $1 AND client_event_id = $2',
        [sessionId, clientEventId]
      )
      if (eventRes.rows.length > 0) {
        eventId = eventRes.rows[0].id
      }
    }

    // 3. Generate media metadata
    const mediaId = uuidv4()
    const ext = mimeType === 'image/png' ? 'png' : 'jpg'
    const storageKey = `sessions/${sessionId}/${mediaId}.${ext}`
    
    // 4. Generate presigned URL (expires in 5 minutes by default)
    const expiresIn = env.MEDIA_UPLOAD_URL_EXPIRY_SECONDS
    const uploadUrl = await this.storageAdapter.getUploadUrl(storageKey, mimeType, expiresIn)

    // 5. Calculate retention expiry timestamp
    const capturedDate = new Date(capturedAt)
    const expiresAt = new Date(capturedDate.getTime() + env.MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000)

    // 6. Insert pending record into database
    const insertQuery = `
      INSERT INTO proctoring_media (
        id, proctoring_session_id, event_id, media_type, status,
        storage_provider, storage_key, mime_type, size_bytes, captured_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `
    const values = [
      mediaId,
      sessionId,
      eventId,
      mediaType,
      MEDIA_STATES.REQUESTED,
      env.MEDIA_STORAGE_PROVIDER,
      storageKey,
      mimeType,
      sizeBytes,
      capturedDate,
      expiresAt
    ]

    const result = await db.query(insertQuery, values)

    return {
      mediaId,
      uploadUrl,
      storageKey,
      expiresIn,
      record: this._mapToCamelCase(result.rows[0])
    }
  }

  /**
   * Finalizes media upload, performing object existence verification.
   */
  async completeUpload(mediaId, sizeBytes) {
    // 1. Fetch media record
    const mediaRes = await db.query('SELECT * FROM proctoring_media WHERE id = $1', [mediaId])
    if (mediaRes.rows.length === 0) {
      throw new Error('Media record not found')
    }
    const media = mediaRes.rows[0]

    // 2. Head check object storage file
    const exists = await this.storageAdapter.objectExists(media.storage_key)
    const newStatus = exists ? MEDIA_STATES.VERIFIED : MEDIA_STATES.FAILED

    // 3. Update database record
    const updateQuery = `
      UPDATE proctoring_media
      SET status = $1, size_bytes = COALESCE($2, size_bytes), created_at = now()
      WHERE id = $3
      RETURNING *;
    `
    const values = [newStatus, sizeBytes || null, mediaId]
    const updateRes = await db.query(updateQuery, values)

    return this._mapToCamelCase(updateRes.rows[0])
  }

  /**
   * Generates short-lived download URL.
   */
  async getDownloadUrl(mediaId) {
    const mediaRes = await db.query('SELECT * FROM proctoring_media WHERE id = $1', [mediaId])
    if (mediaRes.rows.length === 0) {
      return null
    }
    const media = mediaRes.rows[0]

    // Generate a 5-minute GET URL
    const downloadUrl = await this.storageAdapter.getDownloadUrl(media.storage_key, 300)
    return {
      mediaId: media.id,
      downloadUrl,
      expiresIn: 300,
      record: this._mapToCamelCase(media)
    }
  }

  /**
   * Lists all media files for a session.
   */
  async listMediaForSession(sessionId) {
    const query = `
      SELECT m.*, e.type as event_type, e.client_event_id
      FROM proctoring_media m
      LEFT JOIN proctoring_events e ON m.event_id = e.id
      WHERE m.proctoring_session_id = $1
      ORDER BY m.captured_at ASC;
    `
    const res = await db.query(query, [sessionId])
    return res.rows.map(row => this._mapToCamelCase(row))
  }

  /**
   * Cleans up expired media.
   * Runs in background. Deletes files from object storage and updates status to DELETED.
   */
  async cleanupExpiredMedia() {
    console.log('[media-cleanup] starting expired files cleanup...')
    
    // Find all verified/uploaded files that have expired and are not already deleted
    const query = `
      SELECT id, storage_key, storage_provider FROM proctoring_media
      WHERE expires_at < now() AND status NOT IN ($1, $2);
    `
    const res = await db.query(query, [MEDIA_STATES.DELETED, MEDIA_STATES.FAILED])
    
    let deletedCount = 0
    for (const row of res.rows) {
      try {
        console.log(`[media-cleanup] deleting storage object: ${row.storage_key}`)
        await this.storageAdapter.deleteObject(row.storage_key)
        
        await db.query(
          `UPDATE proctoring_media SET status = $1 WHERE id = $2`,
          [MEDIA_STATES.DELETED, row.id]
        )
        deletedCount++
      } catch (err) {
        console.error(`[media-cleanup] failed to delete object ${row.storage_key}:`, err.message)
      }
    }

    console.log(`[media-cleanup] finished. Deleted ${deletedCount} files.`)
    return deletedCount
  }

  /**
   * Helper mapping database row to camelCase camelCase object.
   */
  _mapToCamelCase(row) {
    if (!row) return null
    return {
      id: row.id,
      sessionId: row.proctoring_session_id,
      eventId: row.event_id,
      mediaType: row.media_type,
      status: row.status,
      storageProvider: row.storage_provider,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes ? parseInt(row.size_bytes, 10) : null,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      eventType: row.event_type || null,
      clientEventId: row.client_event_id || null
    }
  }
}

module.exports = new MediaService()
