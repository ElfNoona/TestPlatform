'use strict'

/**
 * grading-service/src/db.js
 *
 * PostgreSQL connection pool for the grading service.
 */

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

pool.on('error', (err) => {
  console.error('[grading-service] Unexpected error on idle client', err)
  process.exit(-1)
})

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
}
