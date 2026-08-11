# compiler-service — Sandboxed Dart Execution

## Purpose

Accepts code submissions, executes them in an isolated Docker container (Dart SDK), and returns stdout/stderr/exitCode. Decoupled from the backend via a BullMQ queue for back-pressure control.

## Architecture

```
POST /run  →  BullMQ queue (Redis)  →  Worker  →  Dockerode  →  sandbox container
GET  /jobs/:id  ←  BullMQ job state (waiting / active / completed / failed)
```

## Stack

- Express 5 (API)
- BullMQ + ioredis (queue)
- Dockerode (container management)
- Dart SDK 3.4 (sandbox image)

## How to run locally

### 1. Build the sandbox image
```bash
npm run sandbox:build
# Equivalent to: docker build -t exam-platform/dart-sandbox:latest ./sandbox
```

### 2. Start (requires Redis to be running)
```bash
# Terminal A — API
npm run dev:api     # → :5000

# Terminal B — Worker
npm run dev:worker
```

Or use Docker Compose from the root:
```bash
docker compose up compiler-api compiler-worker -d
```

## Resource limits per container

| Limit | Value |
|---|---|
| Memory | 256 MB |
| CPU | 0.5 cores (NanoCpus) |
| PIDs | 64 |
| Network | none |
| Root FS | read-only |
| Execution timeout | 10 s (configurable per request) |

## Concurrency

`EXEC_CONCURRENCY` (env var, default 4) controls how many containers run simultaneously.

> **TODO**: tune this — needs a rehearsal run with a full 20-student batch before Aug 30 (see `docs/decisions.md #5`).

## Security notes

- Containers run as non-root `sandbox` user
- Code is bind-mounted read-only from a temp directory, deleted after each run
- No network access: `NetworkMode: none`
- TODO: consider gVisor / Kata Containers for stronger kernel isolation

## How it talks to other services

```
compiler-api  ←  HTTP POST from backend :4000  (run-code requests)
compiler-api  →  Redis (BullMQ)
compiler-worker  ←  Redis (BullMQ)
compiler-worker  →  Docker socket (spawn containers)
```
