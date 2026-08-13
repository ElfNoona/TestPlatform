'use strict'

const jwt = require('jsonwebtoken')
const env = require('../config/env')

/**
 * requireStudentAuth — validates student JWT in the Authorization header.
 * Sets req.student = { studentId, attemptId }
 */
function requireStudentAuth(req, res, next) {
  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }
  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    req.student = payload
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired student token' })
  }
}

/**
 * requireTeacherAuth — validates teacher JWT.
 * Sets req.teacher = { email, role: 'teacher' }
 */
function requireTeacherAuth(req, res, next) {
  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }
  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    if (payload.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher privileges required' })
    }
    req.teacher = payload
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired teacher token' })
  }
}

module.exports = {
  requireStudentAuth,
  requireTeacherAuth
}
