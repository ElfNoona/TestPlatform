#!/usr/bin/env node
'use strict'

/**
 * admin/src/index.js — one-time import CLI.
 *
 * Reads a spreadsheet (xlsx or csv) mapping:
 *   student name | access_code | slot_id | question_set_name
 *
 * Writes rows into the backend's Postgres DB.
 *
 * Usage:
 *   node src/index.js --file students.xlsx [--dry-run]
 *
 * TODO: define the exact spreadsheet column layout once the teacher has it ready
 * TODO: add --question-set flag to import question banks from a separate sheet
 */

require('dotenv').config()
const path   = require('path')
const XLSX   = require('xlsx')
const args   = require('minimist')(process.argv.slice(2))
const { Pool } = require('pg')

const FILE    = args.file || args.f
const DRY_RUN = !!args['dry-run']

if (!FILE) {
  console.error('Usage: node src/index.js --file <path-to-spreadsheet.xlsx> [--dry-run]')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  // 1. Read spreadsheet
  const wb  = XLSX.readFile(path.resolve(FILE))
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws)

  console.log(`[admin] read ${rows.length} rows from ${FILE}`)
  if (DRY_RUN) {
    console.log('[admin] dry-run mode — no DB writes')
    console.table(rows.slice(0, 5))
    return
  }

  // 2. Upsert each row
  let inserted = 0, failed = 0
  for (const row of rows) {
    try {
      // TODO: map column names to DB fields — adjust to match actual spreadsheet layout
      const { name, access_code, slot_id, question_set_id } = row

      if (!name || !access_code) {
        console.warn('[admin] skipping row — missing name or access_code:', row)
        failed++
        continue
      }

      await pool.query(
        `INSERT INTO students (name, access_code, slot_id, question_set_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (access_code) DO UPDATE
           SET name            = EXCLUDED.name,
               slot_id         = EXCLUDED.slot_id,
               question_set_id = EXCLUDED.question_set_id`,
        [name, access_code, slot_id || null, question_set_id || null]
      )
      inserted++
    } catch (err) {
      console.error('[admin] row failed:', row, err.message)
      failed++
    }
  }

  console.log(`[admin] done — inserted/updated: ${inserted}, failed: ${failed}`)
  await pool.end()
}

main().catch((err) => {
  console.error('[admin] fatal error:', err)
  process.exit(1)
})
