'use strict'

const env = require('../config/env')

/**
 * requireServiceAuth — validates server-to-server requests using X-Service-Key.
 */
function requireServiceAuth(req, res, next) {
  const serviceKey = req.headers['x-service-key']
  if (!serviceKey || serviceKey !== env.INTERNAL_SERVICE_KEY) {
    return res.status(403).json({ error: 'Forbidden: Invalid service key' })
  }
  next()
}

module.exports = {
  requireServiceAuth
}
