# Exam Platform — Monorepo

> Timed test-taking platform for ~100 students (batches of 20, 2-hour slots).  
> Dart/Flutter coding questions delivered via a **web-based React** exam runner.

---

## Services

| Service | Description | README |
|---|---|---|
| [`frontend/`](./frontend/README.md) | React (Vite + TypeScript) — login, countdown timer, Monaco editor | [→](./frontend/README.md) |
| [`backend/`](./backend/README.md) | Node/Express API — attempts, answers, auth, admin routes | [→](./backend/README.md) |
| [`compiler-service/`](./compiler-service/README.md) | Sandboxed Dart execution — Express + BullMQ + Dockerode | [→](./compiler-service/README.md) |
| [`grading-service/`](./grading-service/README.md) | AI-suggested grading + teacher review/override | [→](./grading-service/README.md) |
| [`admin/`](./admin/README.md) | CLI: spreadsheet → Postgres (student/slot/question-set import) | [→](./admin/README.md) |
| [`proctoring/`](./proctoring/README.md) | Post-exam video upload handler (storage adapter pattern) | [→](./proctoring/README.md) |
| [`docs/`](./docs/decisions.md) | Architecture notes, open decisions, runbooks | [→](./docs/decisions.md) |

---

## Quick Start (Local Dev)

### Prerequisites
- Docker & Docker Compose v2
- Node.js ≥ 20

### 1. Configure environment
```bash
cp .env.example .env
# Edit .env and fill in any required secrets
```

### 2. Start all containerised services
```bash
docker compose up -d
# Starts: postgres, redis, backend, compiler-service (api + worker), grading-service, proctoring
```

### 3. Run the frontend (separate terminal — not containerised for dev)
```bash
cd frontend
npm install
npm run dev          # → http://localhost:5173
```

### 4. Run the admin import (one-time, not containerised)
```bash
cd admin
npm install
node src/index.js --file path/to/students.xlsx
```

---

## Architecture

```
Browser (Student)
  └─► frontend (React/Vite :5173)
        └─► backend API (:4000)
              ├─► Postgres  ─── attempts, answers, students, question_sets
              ├─► compiler-service API (:5000)
              │       └─► BullMQ queue (Redis) ←── worker
              └─► grading-service (:6000)

Teacher browser
  └─► backend API  (teacher auth — provider TBD, see docs/decisions.md #1)
        └─► grading-service (review / override)

Post-exam
  └─► proctoring service (:7000)  →  object storage (OCI — TBD, decisions.md #4)
```

---

## Open Decisions

Full list in [`docs/decisions.md`](./docs/decisions.md).

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, `@monaco-editor/react` |
| Backend API | Node.js 20, Express 5, PostgreSQL 16, `pg` |
| Job queue | Redis 7, BullMQ |
| Code sandbox | Docker (Dart slim), Dockerode |
| AI grading | Provider TBD |
| Dev orchestration | Docker Compose |
| Upload storage | OCI Block Storage (TBD) |
