# admin — Spreadsheet Import CLI

## Purpose

One-time (or per-exam) script that reads a spreadsheet (xlsx or csv) mapping students → slots → question sets and writes the data into the backend's PostgreSQL database.

**No UI.** Runs on the teacher's machine.

## Stack

- Node.js 20
- `xlsx` — reads Excel and CSV files
- `pg` — writes directly to Postgres
- `minimist` — CLI argument parsing
- `dotenv` — loads `DATABASE_URL` from `.env`

## How to run

```bash
# 1. Set up .env (needs DATABASE_URL)
cp ../.env.example .env
# Edit DATABASE_URL to point to your Postgres instance

# 2. Install deps
npm install

# 3. Dry run (no DB writes) — verify the spreadsheet is being parsed correctly
node src/index.js --file students.xlsx --dry-run

# 4. Real import
node src/index.js --file students.xlsx
```

## Expected spreadsheet columns

> **TODO**: finalise column names once the teacher provides the spreadsheet template.

| Column | Required | Description |
|---|---|---|
| `name` | ✅ | Student full name |
| `access_code` | ✅ | Unique exam access code (pre-generated or teacher-assigned) |
| `slot_id` | ❌ | Exam slot identifier (e.g. `morning`, `afternoon`) |
| `question_set_id` | ❌ | UUID of the question set to assign |

## Open TODOs

- [ ] Confirm spreadsheet column layout with teacher
- [ ] Add `--question-set` flag to import question banks
- [ ] Add `--slots` flag to define slot time windows
- [ ] Add dry-run output to CSV for teacher verification

## How it talks to other services

```
admin CLI  →  postgres :5432 (direct connection — not via backend API)
```
