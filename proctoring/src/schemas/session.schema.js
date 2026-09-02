'use strict'

const { z } = require('zod')

const createSessionSchema = z.object({
  assessmentSessionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  assessmentId: z.string().uuid()
})

const endSessionSchema = z.object({
  sessionId: z.string().uuid().optional()
})

module.exports = {
  createSessionSchema,
  endSessionSchema
}
