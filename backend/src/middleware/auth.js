'use strict'

const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

/**
 * requireStudentAuth — validates the student JWT from the Authorization header.
 * Sets req.student = { studentId, attemptId }
 *
 * TODO: also validate that the attemptId in the token matches the route :id param
 */
function requireStudentAuth(req, res, next) {
  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }
  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (req.params.id && payload.attemptId && String(req.params.id) !== String(payload.attemptId)) {
      return res.status(403).json({ error: 'Token belongs to a different attempt' })
    }
    req.student = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * requireTeacherAuth — validates the teacher JWT.
 * Sets req.teacher = { email, role: 'teacher' }
 *
 * TODO: implement once teacher auth provider is decided (decisions.md #1)
 */
function requireTeacherAuth(req, res, next) {
  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }
  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.role !== 'teacher') throw new Error('Not a teacher token')
    req.teacher = payload
    next()
  } catch {
    res.status(401).json({ error: 'Teacher auth required' })
  }
}

module.exports = { requireStudentAuth, requireTeacherAuth }
