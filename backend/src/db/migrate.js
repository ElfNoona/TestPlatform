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
  question_id      UUID,
  answer_text      TEXT,
  saved_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

-- Question sets (loaded via teacher dashboard or admin CLI)
CREATE TABLE IF NOT EXISTS question_sets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at       TIMESTAMPTZ DEFAULT now(),
  published_at     TIMESTAMPTZ
);

-- Individual questions within a set
-- Contains the evaluation contract consumed by grading/compiler services.
-- Does NOT implement grading logic — stores only what the question is and
-- what configuration the external services should use to evaluate it.
CREATE TABLE IF NOT EXISTS questions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_set_id            UUID REFERENCES question_sets(id) ON DELETE CASCADE,
  type                       TEXT NOT NULL CHECK (type IN ('mcq','output-prediction','debug','coding')),
  prompt                     TEXT NOT NULL,
  options                    TEXT[],          -- MCQ choices only
  starter_code               TEXT,            -- coding / output-prediction / debug
  correct_answer             TEXT,            -- MCQ and output-prediction (for deterministic grading)
  marks                      INT NOT NULL DEFAULT 0,
  evaluation_type            TEXT,            -- e.g. 'compiler_tests', 'exact_match', 'normalised_match'
  evaluation_config_id       TEXT,            -- opaque reference resolved by grading/compiler service
  evaluation_config_version  TEXT,            -- immutable version string for reproducibility
  order_index                INT NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ DEFAULT now(),
  updated_at                 TIMESTAMPTZ DEFAULT now()
);

-- Teacher integrity review decisions (append-only)
CREATE TABLE IF NOT EXISTS teacher_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    UUID REFERENCES attempts(id),
  teacher_id    TEXT NOT NULL,
  verdict       TEXT NOT NULL CHECK (verdict IN ('NO_ISSUE','SUSPICIOUS','VIOLATION')),
  comment       TEXT,
  reviewed_at   TIMESTAMPTZ DEFAULT now()
);

-- Test cases for coding questions (evaluated via Judge0)
CREATE TABLE IF NOT EXISTS test_cases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID REFERENCES questions(id) ON DELETE CASCADE,
  stdin            TEXT DEFAULT '',           -- Standard input passed to the program
  expected_stdout  TEXT NOT NULL,             -- Expected standard output to compare against
  is_hidden        BOOLEAN DEFAULT true,      -- If false, the student sees this test case
  weight           INT DEFAULT 1,             -- Points awarded for passing this case
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Final aggregated grades for a student's answer
CREATE TABLE IF NOT EXISTS grades (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id         UUID REFERENCES attempts(id) ON DELETE CASCADE,
  question_id        UUID REFERENCES questions(id) ON DELETE CASCADE,
  auto_score         NUMERIC(5,2),            -- Score calculated by Judge0/AI
  max_score          NUMERIC(5,2) NOT NULL,   -- Max possible score for the question
  status             TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'GRADED', 'NEEDS_REVIEW', 'ERROR')),
  rationale          TEXT,                    -- E.g., "Passed 4/5 test cases."
  teacher_score      NUMERIC(5,2),            -- Manual override by a teacher
  teacher_comment    TEXT,
  evaluated_at       TIMESTAMPTZ,
  UNIQUE (attempt_id, question_id)
);
`

async function migrate() {
  console.log('[migrate] running schema bootstrap…')
  await pool.query(SQL)
  console.log('[migrate] done')
  await pool.end()
}

migrate().catch((err) => { console.error('[migrate] error', err); process.exit(1) })
