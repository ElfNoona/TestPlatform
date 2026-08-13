'use strict'

const db = require('./index')

const SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Proctoring Sessions
CREATE TABLE IF NOT EXISTS proctoring_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id                UUID UNIQUE NOT NULL,
  student_id                UUID NOT NULL,
  assessment_id             UUID NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'CREATED',
  started_at                TIMESTAMPTZ,
  ended_at                  TIMESTAMPTZ,
  risk_score                INT NOT NULL DEFAULT 0,
  risk_level                TEXT NOT NULL DEFAULT 'LOW',
  tab_switch_count          INT NOT NULL DEFAULT 0,
  fullscreen_exit_count     INT NOT NULL DEFAULT 0,
  copy_count                INT NOT NULL DEFAULT 0,
  paste_count               INT NOT NULL DEFAULT 0,
  camera_interruptions      INT NOT NULL DEFAULT 0,
  screen_interruptions      INT NOT NULL DEFAULT 0,
  last_heartbeat_at         TIMESTAMPTZ,
  connection_status         TEXT NOT NULL DEFAULT 'DISCONNECTED',
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

-- Index on attempt_id for quick lookups
CREATE INDEX IF NOT EXISTS idx_proctoring_sessions_attempt_id ON proctoring_sessions(attempt_id);

-- 2. Proctoring Events
CREATE TABLE IF NOT EXISTS proctoring_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proctoring_session_id  UUID NOT NULL REFERENCES proctoring_sessions(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL,
  client_timestamp       TIMESTAMPTZ NOT NULL,
  server_timestamp       TIMESTAMPTZ DEFAULT now(),
  duration_ms            INT NOT NULL DEFAULT 0,
  metadata               JSONB,
  sequence_number        INT NOT NULL,
  client_event_id        TEXT NOT NULL,
  created_at             TIMESTAMPTZ DEFAULT now(),
  UNIQUE (proctoring_session_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_proctoring_events_session_seq ON proctoring_events(proctoring_session_id, sequence_number);

-- 3. Proctoring Incidents
CREATE TABLE IF NOT EXISTS proctoring_incidents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proctoring_session_id  UUID NOT NULL REFERENCES proctoring_sessions(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL,
  severity               TEXT NOT NULL DEFAULT 'LOW',
  status                 TEXT NOT NULL DEFAULT 'UNREVIEWED',
  started_at             TIMESTAMPTZ NOT NULL,
  ended_at               TIMESTAMPTZ,
  event_count            INT NOT NULL DEFAULT 1,
  description            TEXT,
  metadata               JSONB,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proctoring_incidents_session ON proctoring_incidents(proctoring_session_id);

-- 4. Proctoring Reviews (Incident Reviews - Append-Only)
CREATE TABLE IF NOT EXISTS proctoring_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES proctoring_incidents(id) ON DELETE CASCADE,
  teacher_id  UUID NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('NO_ISSUE', 'SUSPICIOUS', 'VIOLATION')),
  comment     TEXT,
  reviewed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proctoring_reviews_incident ON proctoring_reviews(incident_id);

-- 5. Proctoring Session Reviews (Overall Integrity Reviews - Append-Only)
CREATE TABLE IF NOT EXISTS proctoring_session_reviews (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proctoring_session_id UUID NOT NULL REFERENCES proctoring_sessions(id) ON DELETE CASCADE,
  teacher_id            UUID NOT NULL,
  decision              TEXT NOT NULL CHECK (decision IN ('VALID', 'SUSPICIOUS', 'VIOLATION')),
  comment               TEXT,
  reviewed_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proctoring_session_reviews_session ON proctoring_session_reviews(proctoring_session_id);

-- Migration steps for existing tables:
ALTER TABLE proctoring_incidents ALTER COLUMN status SET DEFAULT 'UNREVIEWED';
UPDATE proctoring_incidents SET status = 'UNREVIEWED' WHERE status = 'OPEN';
`

async function migrate() {
  console.log('[proctoring-migrate] running schema bootstrap…')
  await db.query(SQL)
  console.log('[proctoring-migrate] schemas ensured')
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('[proctoring-migrate] success')
      process.exit(0)
    })
    .catch((err) => {
      console.error('[proctoring-migrate] migration failed', err)
      process.exit(1)
    })
}

module.exports = migrate
