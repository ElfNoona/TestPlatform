'use strict'

const { z } = require('zod')

const eventItemSchema = z.object({
  clientEventId: z.string().min(1),
  type: z.string().min(1),
  clientTimestamp: z.string().datetime(),
  durationMs: z.number().int().nonnegative().default(0),
  sequenceNumber: z.number().int().nonnegative(),
  metadata: z.record(z.any()).optional().default({})
})

const singleEventSchema = eventItemSchema.extend({
  sessionId: z.string().uuid()
})

const batchEventsSchema = z.object({
  sessionId: z.string().uuid(),
  events: z.array(eventItemSchema).nonempty()
})

module.exports = {
  eventItemSchema,
  singleEventSchema,
  batchEventsSchema
}
