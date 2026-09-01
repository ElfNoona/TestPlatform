'use strict'

/**
 * error-handler.js — Express global error handler middleware.
 */
function errorHandler(err, req, res, next) {
  console.error('[proctoring-error]', err)

  const status = err.status || 500
  const message = err.message || 'Internal server error'

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
}

module.exports = errorHandler
