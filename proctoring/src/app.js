'use strict'

const express = require('express')
const cors = require('cors')

const healthRouter = require('./routes/health')
const sessionRouter = require('./routes/session')
const eventRouter = require('./routes/event')
const incidentRouter = require('./routes/incident')
const uploadRouter = require('./routes/upload')
const mediaRouter = require('./routes/media')
const errorHandler = require('./middleware/error-handler')

const app = express()

app.use(cors())
app.use(express.json())

// Mount routes
app.use('/health', healthRouter)
app.use('/api/v1/health', healthRouter)

// Both public /api/v1 and internal prefixes are routed to corresponding files
app.use(sessionRouter)
app.use(eventRouter)
app.use(incidentRouter)
app.use(uploadRouter)
app.use(mediaRouter)

// Global error handler
app.use(errorHandler)

module.exports = app
