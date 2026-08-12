'use strict'

const { z } = require('zod')

const createReviewSchema = z.object({
  decision: z.enum(['NO_ISSUE', 'SUSPICIOUS', 'VIOLATION']),
  comment: z.string().optional()
})

const createSessionReviewSchema = z.object({
  decision: z.enum(['VALID', 'SUSPICIOUS', 'VIOLATION']),
  comment: z.string().optional()
})

module.exports = {
  createReviewSchema,
  createSessionReviewSchema
}
