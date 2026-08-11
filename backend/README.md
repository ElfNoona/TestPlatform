# backend — Node/Express API

## Purpose

Core application API. Manages exam attempts, stores answers, enforces server-side time cutoffs, handles teacher auth, and exposes admin routes.

## Stack

- Node.js 20, Express 5
- PostgreSQL 16 via `pg` (node-postgres)
- `jsonwebtoken` for student + teacher JWTs

## Running locally

```bash
# 1. Ensure Postgres and Redis are running (via docker compose)
docker compose up postgres redis -d

# 2. Bootstrap the schema (first time only)
npm install
npm run db:migrate

# 3. Start in dev mode
npm run dev   # → :4000
```

## Key endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/attempts/start` | Validate access code, create attempt, return JWT |
| `GET` | `/attempts/:id/state` | **Server-authoritative** remaining time + question list |
| `POST` | `/attempts/:id/answers` | Upsert answers (autosave) |
| `POST` | `/attempts/:id/submit` | Final submission (enforces cutoff server-side) |
| `POST` | `/auth/teacher/magic-link` | Request magic link (stub) |
| `GET` | `/auth/teacher/magic-link/verify` | Verify magic link token (stub) |
| `GET` | `/auth/teacher/google` | Google OAuth initiation (stub) |
| `GET` | `/admin/students` | List students (teacher auth required) |

## Timer design

`GET /attempts/:id/state` computes:
```
remainingSeconds = attempt.duration_seconds - (now() - attempt.start_time)
```
The frontend polls this every 30 s. The server enforces the cutoff — it will refuse `/answers` and `/submit` calls if `remainingSeconds <= 0`.

## Open TODOs

- [ ] Implement all DB queries (stubs exist in routes/)
- [ ] Teacher auth — awaiting provider decision (decisions.md #1)
- [ ] Slot window validation on `/attempts/start`
- [ ] Trigger grading-service on submit
- [ ] Add proper migration tooling (node-pg-migrate or Drizzle)

## How it talks to other services

```
backend → postgres :5432    (primary store)
backend → compiler-service :5000  (via HTTP, for run-code requests)
backend → grading-service :6000   (trigger grading on submit)
```
