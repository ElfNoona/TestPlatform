'use strict'

/**
 * db/index.js — PostgreSQL connection pool.
 *
 * Uses node-postgres (pg). The pool is shared across the entire app.
 *
 * Tables (minimal stub — expand with real schema):
 *   students         (id, name, access_code, slot_id, question_set_id, created_at)
 *   attempts         (id, student_id, start_time, submitted_at, created_at)
 *   answers          (id, attempt_id, question_id, answer_text, saved_at)
 *   question_sets    (id, name, created_at)
 *   questions        (id, question_set_id, type, prompt, starter_code, correct_answer, order_index)
 *
 * TODO: add slots table if slot-based scheduling needs its own entity
 * TODO: consider a proper migration tool (e.g. node-pg-migrate, Drizzle ORM)
 */

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 100, // Handle high concurrency requests across 300 active users
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err)
})

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
}
