# KRS Assessment Platform — Monorepo

> Timed, proctored examination platform for ~100 students (batches of 20, 2-hour slots).
> Dart/Flutter coding questions delivered via a **web-based React** exam runner.

---

## Service Map

| Service | Port | Description |
|---|---|---|
| [`frontend/`](./frontend/README.md) | `5173` | React (Vite + TypeScript) — candidate exam UI, proctoring client, teacher review dashboard |
| [`backend/`](./backend/README.md) | `4000` | Node/Express — attempts, answers, questions, auth, admin routes. The assessment platform data owner. |
| [`compiler-service/`](./compiler-service/README.md) | `5000` | Sandboxed Dart execution — Express + BullMQ + Dockerode. Owned independently. |
| [`grading-service/`](./grading-service/README.md) | `6000` | Evaluation orchestrator — consumes evaluation contracts from questions, produces automatic scores for teacher review. Owned independently. |
| [`proctoring/`](./proctoring/README.md) | `7000` | Real-time WebSocket telemetry, risk scoring, webcam/screen evidence, R2 media storage. |
| [`admin/`](./admin/README.md) | CLI | Spreadsheet → PostgreSQL import (students, slots, question sets). |
| [`docs/`](./docs/decisions.md) | — | Architecture decisions, open questions, runbooks. |

---

## Architecture

The platform is organized around a **clear service ownership boundary**:

```
                    ┌──────────────────────────────────────────────────┐
                    │              Assessment Platform                 │
                    │                                                  │
                    │  Questions → Sets → Attempts → Answers           │
                    │                    │                             │
                    │                    ▼                             │
                    │              Teacher Review                      │
                    └────────────────────┬─────────────────────────────┘
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                       Grading Service        Proctoring Service
                              │                     │
                              ▼                     ├── WebSocket Telemetry
                       Compiler Service             ├── Risk Scoring
                                                    └── R2 Media Evidence
```

### Data Ownership
| Service | Owns |
|---|---|
| **Assessment backend** | `questions`, `question_sets`, `attempts`, `answers`, `automatic_results`, `teacher_adjustments` |
| **Grading service** | Evaluation jobs, grading rules, automatic scores |
| **Compiler service** | Code execution, sandboxing, test results, resource limits |
| **Proctoring service** | `proctoring_sessions`, `proctoring_events`, incidents, risk scores, media metadata, R2 evidence, integrity reviews |

### Key Architectural Invariants

- **Media failure ≠ exam failure.** Camera/screen snapshot outages do not interrupt active exams or telemetry.
- **Compiler outage ≠ telemetry outage.** All services are independently deployable.
- **Assessment platform owns the evaluation contract, not the evaluator.** The backend stores `evaluation_config_id` and `marks` — it does not implement grading or compile code.
- **Question sets are immutable once an attempt begins.** Every attempt records its exact `question_set_id`; the evaluation configuration used is reproducible for audit.

### Full Candidate Flow

```
Browser (Candidate)
  │
  ├── SystemCheck (WebRTC / WS / Camera / Fullscreen)
  │
  ▼
frontend :5173
  │
  ├── /api/*  ──────────────────────────► backend :4000
  │                                              │
  │                                              ├── postgres :5432
  │                                              ├── compiler-service :5000
  │                                              └── grading-service :6000
  │
  └── WebSocket + Media ─────────────► proctoring :7000
                                                  │
                                                  ├── Redis / BullMQ
                                                  ├── postgres :5432
                                                  └── AWS S3 / Cloudflare R2

Teacher browser
  └── /teacher (frontend)
        ├── backend :4000  (candidates, attempts, answers, grades)
        └── proctoring :7000  (sessions, timeline, media evidence)
```

---

## Quick Start (Local Dev)

### Prerequisites
- Docker & Docker Compose v2
- Node.js ≥ 20

### 1. Configure environment
```bash
cp .env.example .env
# Edit .env — fill in JWT_SECRET, DB credentials, and storage provider keys
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

### 4. Bootstrap the backend schema (first time only)
```bash
cd backend
npm run db:migrate
```

### 5. Import students (per exam sitting)
```bash
cd admin
npm install
node src/index.js --file path/to/students.xlsx
```

---

## Question Upload

Teachers upload question sets as JSON files via the `/teacher` dashboard or the admin CLI.

Each question record contains only the **definition and evaluation contract** — not grading logic:

```json
{
  "type": "mcq",
  "prompt": "Which of the following declares a nullable String in Dart?",
  "options": ["String name;", "String? name;", "nullable String name;", "String name = null;"],
  "correct_answer": "String? name;",
  "marks": 2,
  "order_index": 0
}
```

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
  },
  "order_index": 1
}
```

The assessment backend validates structure and evaluation references. The compiler and grading services resolve `evaluation_config_id` at grading time.

---

## Grading Architecture

```
MCQ / Output Prediction
        ↓
  Grading Service
        ↓
  Deterministic / normalised comparison
        ↓
  automatic_score → PostgreSQL

Coding / Debug
        ↓
  Grading Service
        ↓
  Compiler / Execution Service
        ↓
  test results → marks
        ↓
  automatic_score → PostgreSQL (pending teacher review)

Teacher Review
        ↓
  automatic_score (read-only)
  teacher_adjustment (±)
  final_score = automatic_score + teacher_adjustment
  comment, reviewed_at → PostgreSQL
```

---

## Proctoring Evidence Flow

```
Candidate Browser
        │
        ├── WebSocket telemetry ──► proctoring :7000 ──► Redis/BullMQ ──► PostgreSQL
        │        (TAB_HIDDEN, COPY, PASTE, FULLSCREEN_EXITED, ...)
        │
        └── Media snapshots (every 60s webcam / 120s screen)
                 │
                 ├── POST /api/v1/media/upload-url  ──► proctoring generates presigned URL
                 ├── PUT <presigned-url> (binary JPEG direct to S3/R2)
                 └── POST /api/v1/media/:id/complete ──► proctoring verifies & stores metadata
```

**Cost estimation (100 candidates, 90-min exam):**
- Webcam: 90 snapshots × 25 KB ≈ 2.25 MB per candidate
- Screen:  45 snapshots × 120 KB ≈ 5.4 MB per candidate
- Total: ~765 MB for all 100 candidates (< $0.02 on S3/R2)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, `@monaco-editor/react` |
| Backend API | Node.js 20, Express 5, PostgreSQL 16, `pg` |
| Job queue | Redis 7, BullMQ |
| Code sandbox | Docker (Dart SDK 3.4 slim), Dockerode |
| Grading | Grading service (AI provider TBD — see `docs/decisions.md`) |
| Proctoring WebSocket | `ws` library, JWT handshake, rate-limited gateway |
| Evidence storage | AWS S3 `ap-south-1` (Cloudflare R2 adapter also available) |
| Dev orchestration | Docker Compose |

---

## Open Decisions

Full list in [`docs/decisions.md`](./docs/decisions.md).

| # | Topic | Status |
|---|---|---|
| 1 | Teacher auth mechanism (magic link vs Google OAuth) | 🔴 Open |
| 2 | Teacher review/grading UI scope | 🟡 In progress |
| 3 | Widget-test screenshot comparison | 🔵 Out of scope (post Aug 30) |
| 4 | Proctoring storage provider | ✅ Resolved — AWS S3 `ap-south-1` |
| 5 | `EXEC_CONCURRENCY` tuning | 🟡 Needs rehearsal |
| 6 | Frontend stack (Flutter → React) | ✅ Resolved |
| 7 | Screen-sharing policy | 🟡 Pending teacher policy decision |
