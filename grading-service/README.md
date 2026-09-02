# grading-service — Evaluation Orchestrator

## Purpose

Grades exam submissions by consuming the **evaluation contracts** defined in the assessment backend's question records. Produces automatic scores for teacher review.

> **Architectural boundary**: The grading service owns *how answers are evaluated*. It does not own question definitions, candidate data, or attempt lifecycle management — those belong to the assessment backend.

---

## Stack

- Node.js 20, Express 5
- PostgreSQL 16 (store `automatic_results`, `teacher_adjustments`)
- BullMQ + Redis (async grading job queue)
- AI provider SDK (TBD — see `docs/decisions.md`)

---

## How to Run Locally

```bash
npm install
npm run dev   # → :6000
```

Or via Docker Compose (from root):
```bash
docker compose up grading-service -d
```

---

## Grading Logic

| Question type | Method | Auto-final |
|---|---|---|
| `mcq` | Exact answer-key match against `correct_answer` | ✅ Yes |
| `output-prediction` | Trimmed/normalised string comparison | ✅ Yes |
| `coding` | Delegates to compiler-service via `evaluation_config_id`; AI suggestion for partial credit | ❌ Needs teacher review |
| `debug` | Delegates to compiler-service; AI suggestion for partial credit | ❌ Needs teacher review |

### Grading Flow

```
Attempt submitted
      ↓
backend → POST /grade (attemptId, answers[])
      ↓
grading-service resolves evaluation contracts per question
      ↓
MCQ / output-prediction → deterministic comparison
      ↓
coding / debug → compiler-service (evaluation_config_id)
      ↓
compiler-service → test results → marks
      ↓
automatic_score stored in PostgreSQL
      ↓
Teacher review (override possible)
      ↓
final_score = automatic_score + teacher_adjustment
```

### Teacher Score Model

```
automatic_score     (read-only, produced by grading service)
teacher_adjustment  (±, entered by teacher)
final_score         (automatic_score + teacher_adjustment)
comment             (teacher's review notes)
reviewed_at         (timestamp)
teacher_id          (audit trail)
```

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/grade` | Grade all answers for an attempt (triggered by backend on submit) |
| `GET` | `/review/attempts/:id` | Get all grades for an attempt (teacher auth required) |
| `POST` | `/review/grades/:id/override` | Teacher override a grade (append-only audit trail) |

---

## Open TODOs

- [ ] Implement deterministic MCQ/output grading (`graders/index.js` has the stub)
- [ ] Implement `evaluation_config_id` resolution and compiler-service delegation
- [ ] Lock in AI provider for coding/debug suggestion (OpenAI, Gemini, or Anthropic — `docs/decisions.md`)
- [ ] Persist grades to PostgreSQL
- [ ] Add teacher auth to review routes
- [ ] Implement grading job queue (BullMQ) for async processing at scale
- [ ] Handle grading-service unavailable gracefully (backend should not block submit if grading is down)

---

## How it Talks to Other Services

```
grading-service  ←  HTTP POST from backend :4000   (triggered on attempt submit)
grading-service  →  compiler-service :5000          (coding/debug evaluation)
grading-service  →  postgres :5432                  (store automatic_results, teacher_adjustments)
grading-service  →  AI provider API                 (coding/debug suggestions — TBD)
```
