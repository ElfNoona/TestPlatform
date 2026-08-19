# admin — Spreadsheet Import CLI

## Purpose

One-time (or per-exam) script that reads a spreadsheet (xlsx or csv) mapping students → slots → question sets and writes the data into the backend's PostgreSQL database.

**No UI.** Runs directly on the teacher's or admin's machine.

---

## Stack

- Node.js 20
- `xlsx` — reads Excel and CSV files
- `pg` — writes directly to Postgres
- `minimist` — CLI argument parsing
- `dotenv` — loads `DATABASE_URL` from `.env`

---

## How to Run

```bash
# 1. Configure (needs DATABASE_URL)
cp ../.env.example .env

# 2. Install deps
npm install

# 3. Dry run — verify spreadsheet parsing without writing to DB
node src/index.js --file students.xlsx --dry-run

# 4. Real import
node src/index.js --file students.xlsx
```

---

## Expected Spreadsheet Columns

> **TODO**: Finalise column names once the teacher provides the spreadsheet template.

| Column | Required | Description |
|---|---|---|
| `name` | ✅ | Student full name |
| `access_code` | ✅ | Unique exam access code (pre-generated or teacher-assigned) |
| `slot_id` | ❌ | Exam slot identifier (e.g. `morning`, `afternoon`) |
| `question_set_id` | ❌ | UUID of the question set to assign to this student |

---

## Relationship to Question Upload

The admin CLI imports **student records** and their **question set assignment**.

The question sets themselves (questions, evaluation contracts, marks) are created separately — either via:
- The `/teacher/question-sets` UI in the frontend (planned), or
- Direct API calls to `POST /admin/question-sets` + `POST /admin/question-sets/:id/questions` on the backend.

The CLI does **not** create or modify question content.

---

## Open TODOs

- [ ] Confirm spreadsheet column layout with teacher
- [ ] Add `--slots` flag to define exam slot time windows
- [ ] Add dry-run output to CSV for teacher verification
- [ ] Support `--question-set` flag to associate a set ID with a cohort of students

---

## How it Talks to Other Services

```
admin CLI  →  postgres :5432  (direct connection — bypasses backend API)
```
