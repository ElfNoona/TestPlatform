'use strict'

const { z } = require('zod')
const { MEDIA_TYPES } = require('../config/constants')

const requestUploadUrlSchema = z.object({
  sessionId: z.string().uuid(),
  mediaType: z.enum([
    MEDIA_TYPES.WEBCAM_SNAPSHOT,
    MEDIA_TYPES.EVENT_SNAPSHOT,
    MEDIA_TYPES.START_SNAPSHOT,
    MEDIA_TYPES.FINAL_SNAPSHOT
  ]),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024), // Keep it reasonably high but bound it
  clientEventId: z.string().optional(),
  capturedAt: z.string().datetime()
})

const completeUploadSchema = z.object({
  sizeBytes: z.number().int().positive().optional()
})

module.exports = {
  requestUploadUrlSchema,
  completeUploadSchema
}
