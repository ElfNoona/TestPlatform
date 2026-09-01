# backend — Assessment Platform API

## Purpose

The **data owner and orchestrator** for the assessment platform. Manages:

- Student authentication (access codes → JWT)
- Exam attempt lifecycle (start, autosave, submit, time enforcement)
- Question sets and individual question definitions
- Evaluation contract references (passed to grading/compiler services at grading time)
- Teacher authentication and admin routes
- Inter-service coordination (triggers grading-service on submit)

> **Architectural boundary**: The backend stores *what the question is* and *what evaluation configuration it requires*. It does **not** implement grading algorithms, compile code, or execute tests — those belong to the grading-service and compiler-service respectively.

---

## Stack

- Node.js 20, Express 5
- PostgreSQL 16 via `pg` (node-postgres)
- `jsonwebtoken` for student + teacher JWTs
- `bcryptjs` for credential hashing

---

## Running Locally

```bash
# 1. Start Postgres and Redis
docker compose up postgres redis -d

# 2. Bootstrap schema (first time only)
npm install
npm run db:migrate

# 3. Start dev server
npm run dev   # → :4000
```

---

## Key Endpoints

### Student (JWT required after login)

| Method | Path | Description |
|---|---|---|
| `POST` | `/attempts/start` | Validate access code, create attempt, return student JWT + proctoring session ID |
| `GET` | `/attempts/:id/state` | **Server-authoritative** remaining time + assigned question list |
| `POST` | `/attempts/:id/answers` | Upsert answers (autosave — idempotent) |
| `POST` | `/attempts/:id/submit` | Final submission (enforces server-side cutoff) |

### Teacher (teacher JWT required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/teacher/magic-link` | Request magic link (stub) |
| `GET` | `/auth/teacher/magic-link/verify` | Verify token (stub) |
| `GET` | `/admin/students` | List all students |
| `POST` | `/admin/students` | Upsert student (name, access_code, slot_id, question_set_id) |
| `GET` | `/admin/question-sets` | List question sets |
| `POST` | `/admin/question-sets` | Create new question set |
| `POST` | `/admin/question-sets/:id/questions` | Bulk-upload questions (JSON array, transactional) |

---

## Database Schema

```sql
students          — name, access_code, slot_id, question_set_id
attempts          — student_id, start_time, duration_seconds, submitted_at
answers           — attempt_id, question_id, answer_text (UNIQUE per attempt+question)
question_sets     — name, version, status, created_at
questions         — question_set_id, type, prompt, options[], starter_code,
                    correct_answer, marks,
                    evaluation_type, evaluation_config_id, evaluation_config_version,
                    order_index
```

---

## Question Schema and Evaluation Contracts

Questions carry an evaluation contract that the grading/compiler services consume at grading time. The backend validates structure; it does **not** run evaluations.

### MCQ
```json
{
  "type": "mcq",
  "prompt": "Which syntax declares a nullable String?",
  "options": ["String name;", "String? name;", "nullable String name;", "String name = null;"],
  "correct_answer": "String? name;",
  "marks": 2
}
```

### Output Prediction
```json
{
  "type": "output-prediction",
  "prompt": "What does the program print?",
  "starter_code": "void main() { print([1,2,3].map((x) => x*2).toList()); }",
  "correct_answer": "[2, 4, 6]",
  "marks": 3
}
```

### Coding / Debug
```json
{
  "type": "coding",
  "prompt": "Write a Dart function int sumList(List<int> nums) ...",
  "starter_code": "int sumList(List<int> nums) {\n  // TODO\n}",
  "marks": 10,
  "evaluation": {
    "language": "dart",
    "evaluation_type": "compiler_tests",
    "evaluation_config_id": "eval_dart_sum_v1"
  }
}
```

The grading service resolves `evaluation_config_id` against its own configuration registry. The assessment backend does not know how the compiler executes the tests.

---

## Timer Design

`GET /attempts/:id/state` computes:
```
remainingSeconds = attempt.duration_seconds - (now() - attempt.start_time)
```

The frontend polls every 30 s and derives its display timer from the server value. The server refuses `/answers` and `/submit` calls once `remainingSeconds ≤ 0`.

---

## Question Set Versioning & Immutability

Once an attempt begins, its assigned `question_set_id` is immutable. If a teacher modifies questions, they must publish a new version. This ensures:
- Grading is reproducible: "Why did candidate 42 score X/Y?" has a definitive answer.
- Existing in-progress attempts are not affected by question edits.

---

## Open TODOs

- [ ] Implement all DB query stubs (routes have TODO markers)
- [ ] Teacher auth — pick magic link or Google OAuth (see `docs/decisions.md #1`)
- [ ] Slot window validation on `/attempts/start`
- [ ] Trigger grading-service on submit
- [ ] Question set versioning (`status: draft → published`)
- [ ] Bulk question upload — transactional insert (rollback entire set if any question is invalid)
- [ ] Add proper migration tooling (node-pg-migrate or Drizzle)

---

## How it Talks to Other Services

```
backend → postgres :5432           (primary store for all assessment data)
backend → proctoring :7000         (POST /internal/sessions on attempt start)
backend → compiler-service :5000   (run-code requests — evaluation only)
backend → grading-service :6000    (trigger grading on attempt submit)
```
