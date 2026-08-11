# grading-service — AI-Suggested Grading

## Purpose

Grades exam submissions. Auto-grades MCQ and output-prediction questions. Uses an AI model to suggest scores for coding and debug questions. Exposes a review/override API for teachers.

## Stack

- Node.js 20, Express 5
- PostgreSQL 16 (to store grades)
- `openai` SDK (or equivalent — provider TBD)

## How to run locally

```bash
npm install
npm run dev   # → :6000
```

Or via Docker Compose (from root):
```bash
docker compose up grading-service -d
```

## Grading logic

| Question type | Method | Auto-final |
|---|---|---|
| `mcq` | Exact answer-key match | ✅ Yes |
| `output-prediction` | Trimmed string match | ✅ Yes |
| `coding` | AI model suggestion | ❌ Needs teacher review |
| `debug` | AI model suggestion | ❌ Needs teacher review |

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/grade` | Grade all answers for an attempt |
| `GET` | `/review/attempts/:id` | Get all grades for an attempt (teacher) |
| `POST` | `/review/grades/:id/override` | Teacher override a grade |

## Open TODOs

- [ ] Implement AI grading calls (`graders/index.js` has the stub)
- [ ] Lock in AI provider (OpenAI, Gemini, or Anthropic — decisions.md)
- [ ] Persist grades to DB
- [ ] Add teacher auth to review routes
- [ ] Screenshot comparison for widget-test questions — not confirmed (decisions.md #3)

## How it talks to other services

```
grading-service  ←  HTTP POST from backend (triggered on submit)
grading-service  →  postgres :5432 (store grades)
grading-service  →  AI provider API (external, TBD)
```
