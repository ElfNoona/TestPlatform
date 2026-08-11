'use strict'

/**
 * routes/admin.js — protected routes for admin operations.
 * These are called internally (or by the admin CLI), not by students.
 *
 * GET  /admin/students        — list all students (teacher auth required)
 * POST /admin/students        — create/upsert a student (used by admin CLI)
 * GET  /admin/question-sets   — list question sets
 * TODO: add slot management routes
 */

const { Router } = require('express')
const { requireTeacherAuth } = require('../middleware/auth')

const router = Router()

router.get('/students', requireTeacherAuth, async (req, res, next) => {
  try {
    // TODO: SELECT * FROM students ORDER BY name
    res.json({ students: [] })
  } catch (err) { next(err) }
})

router.post('/students', requireTeacherAuth, async (req, res, next) => {
  try {
    const { name, accessCode, slotId, questionSetId } = req.body
    // TODO: INSERT INTO students (name, access_code, slot_id, question_set_id) VALUES (...)
    //       ON CONFLICT (access_code) DO UPDATE SET ...
    res.status(201).json({ message: 'Student upserted (TODO)' })
  } catch (err) { next(err) }
})

router.get('/question-sets', requireTeacherAuth, async (req, res, next) => {
  try {
    // TODO: SELECT * FROM question_sets
    res.json({ questionSets: [] })
  } catch (err) { next(err) }
})

module.exports = router
