'use strict'

/**
 * db/migrate.js — minimal schema bootstrap.
 *
 * Run once: `node src/db/migrate.js`
 * Creates tables if they don't exist. NOT a proper migration system —
 * TODO: replace with node-pg-migrate or similar before go-live.
 */

require('dotenv').config()
const { pool } = require('./index')

const SQL = `
-- Students imported from spreadsheet via admin CLI
CREATE TABLE IF NOT EXISTS students (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  access_code      TEXT UNIQUE NOT NULL,
  slot_id          TEXT,                      -- TODO: normalise to a slots table
  question_set_id  UUID,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- One attempt per student per exam sitting
CREATE TABLE IF NOT EXISTS attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID REFERENCES students(id),
  start_time       TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at     TIMESTAMPTZ,               -- NULL until submitted
  duration_seconds INT NOT NULL DEFAULT 7200, -- 2-hour default
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- One row per saved answer (upsert on question_id + attempt_id)
CREATE TABLE IF NOT EXISTS answers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       UUID REFERENCES attempts(id),
  question_id      UUID,                      -- TODO: FK to questions once schema is set
  answer_text      TEXT,
  saved_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

-- Question sets (loaded via admin import)
CREATE TABLE IF NOT EXISTS question_sets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Individual questions within a set
CREATE TABLE IF NOT EXISTS questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_set_id  UUID REFERENCES question_sets(id),
  type             TEXT NOT NULL CHECK (type IN ('mcq','output-prediction','debug','coding')),
  prompt           TEXT NOT NULL,
  starter_code     TEXT,
  correct_answer   TEXT,                      -- used for MCQ and output-prediction auto-grading
  order_index      INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);
`

async function migrate() {
  console.log('[migrate] running schema bootstrap…')
  await pool.query(SQL)
  console.log('[migrate] done')
  await pool.end()
}

migrate().catch((err) => { console.error('[migrate] error', err); process.exit(1) })
