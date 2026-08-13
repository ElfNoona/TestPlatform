'use strict'

const { Pool } = require('pg')
const env = require('../config/env')

const pool = new Pool({
  connectionString: env.DATABASE_URL
})

pool.on('error', (err) => {
  console.error('[proctoring-db] unexpected pool error', err)
})

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
}
