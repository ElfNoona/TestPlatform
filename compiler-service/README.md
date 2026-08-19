# compiler-service — Sandboxed Dart Execution

## Purpose

Accepts code execution requests from the grading service, runs candidate code in an isolated Docker container (Dart SDK), and returns `stdout`, `stderr`, and `exitCode`.

> **Architectural boundary**: The compiler service owns code *execution*, *sandboxing*, and *resource enforcement*. It does not own question definitions, evaluation configuration schemas, or grading rules — those belong to the assessment backend and grading service respectively. Callers reference compiler configurations by an opaque `evaluation_config_id`; the compiler service resolves that ID to its own internal execution configuration.

Decoupled from the backend and grading-service via a BullMQ queue for back-pressure control.

---

## Architecture

```
Grading Service
      │
      ▼
POST /run  →  BullMQ queue (Redis)  →  Worker  →  Dockerode  →  Dart sandbox container
                                                                         │
GET /jobs/:id  ←  BullMQ job state (waiting / active / completed / failed)
```

---

## Stack

- Express 5 (API)
- BullMQ + ioredis (queue)
- Dockerode (container management)
- Dart SDK 3.4 slim (sandbox image)

---

## How to Run Locally

### 1. Build the sandbox image
```bash
npm run sandbox:build
# Equivalent to: docker build -t exam-platform/dart-sandbox:latest ./sandbox
```

### 2. Start (requires Redis)
```bash
# Terminal A — API
npm run dev:api     # → :5000

# Terminal B — Worker
npm run dev:worker
```

Or via Docker Compose:
```bash
docker compose up compiler-api compiler-worker -d
```

---

## Resource Limits Per Container

| Limit | Value |
|---|---|
| Memory | 256 MB |
| CPU | 0.5 cores (NanoCpus) |
| PIDs | 64 |
| Network | `none` (no internet access) |
| Root FS | read-only |
| Execution timeout | 10 s (configurable per request) |

---

## Concurrency

`EXEC_CONCURRENCY` (env var, default `4`) controls simultaneous containers.

> **TODO**: Tune before Aug 30 rehearsal — a batch of 20 students all submitting simultaneously could produce up to `20 × (code questions)` concurrent jobs. See `docs/decisions.md #5`.

---

## Security Notes

- Containers run as non-root `sandbox` user
- Code is bind-mounted read-only from a temp directory, deleted after each run
- No network access: `NetworkMode: none`
- TODO: evaluate gVisor / Kata Containers for stronger kernel isolation

---

## What the Compiler Service Does NOT Own

| Concern | Owner |
|---|---|
| Question definition | Assessment backend |
| `evaluation_config_id` schema | Assessment backend |
| Grading rules (marks per test) | Grading service |
| AI-suggested partial credit | Grading service |
| Teacher adjustments | Grading service |
| Candidate data | Assessment backend |

---

## How it Talks to Other Services

```
compiler-api  ←  HTTP POST from grading-service :6000  (evaluation requests)
compiler-api  →  Redis (BullMQ queue)
compiler-worker  ←  Redis (BullMQ)
compiler-worker  →  Docker socket (spawn Dart sandbox containers)
```
