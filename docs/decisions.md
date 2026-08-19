# Architecture Decisions

This file tracks architectural and product decisions.
Unresolved decisions block or constrain implementation work — do not implement the affected area until the decision is recorded here.

Last updated: 2026-08-17

---

## Decision 1 — Teacher Auth Mechanism

**Status**: ✅ Resolved (2026-08-17)
**Affects**: `backend/src/routes/teacherAuth.js`, `backend/src/middleware/auth.js`

**Decision**: **Teacher Access Code** — teachers authenticate using a shared administrative access code.

**What was implemented**:
- `POST /auth/teacher/login` — verifies the code matches the `TEACHER_ACCESS_CODE` environment variable (default: `TEACHER-2026`) and issues a signed teacher JWT with `{ role: 'teacher' }`.
- Frontend login page switcher link to toggle between Candidate and Teacher login portals.
- Teacher tokens are saved automatically to `localStorage` and sent in the `Authorization` header for all admin APIs.

---

## Decision 2 — Teacher Review / Grading UI

**Status**: 🟡 In Progress
**Affects**: `frontend/src/pages/TeacherDashboard.tsx` (planned), `grading-service/src/routes/review.js`

Planned implementation:
- `/teacher` — candidate list with risk scores pulled from proctoring service
- `/teacher/session/:id` — timeline of events + R2 evidence snapshot viewer + integrity decision form
- `/teacher/question-sets` — question set management + bulk JSON upload

**Open sub-questions**:
- Is batch grade approval needed, or per-question override only?
- Should the teacher dashboard be part of `frontend/` or a separate admin app?

---

## Decision 3 — Widget-Test Screenshot Comparison

**Status**: 🔵 Out of Scope (post Aug 30)
**Affects**: `compiler-service/`, `grading-service/`

Flutter widget rendering in the sandbox requires a display server (Xvfb or similar).
Confirmed out of scope for August 30 exam — pure Dart logic questions only.

---

## Decision 4 — Proctoring Storage Provider

**Status**: ✅ Resolved (2026-08-16)
**Affects**: `proctoring/src/storage/`, `proctoring/src/services/media.service.js`

**Decision**: **AWS S3** — `ap-south-1` (Mumbai) for lowest latency to India-based candidates. Cloudflare R2 adapter also available via `MEDIA_STORAGE_PROVIDER=r2`.

**What was implemented**:
- `S3StorageAdapter` — extends `StorageAdapter` interface
- `MEDIA_STORAGE_PROVIDER=s3` activates it in `media.service.js`
- Fail-fast startup guard if required env vars are missing

**Pending (manual AWS console)**:
- Create S3 bucket `exam-proctoring-media` in `ap-south-1`
- Create IAM user `exam-proctoring-s3` (least-privilege: PutObject, GetObject, DeleteObject, HeadObject)
- Set CORS policy (AllowedOrigins: exam domain, Methods: PUT/GET/HEAD)
- Set lifecycle rule: auto-delete objects in `sessions/` after 35 days

---

## Decision 5 — `EXEC_CONCURRENCY` for Compiler Service

**Status**: 🟡 Unvalidated — needs rehearsal
**Affects**: `compiler-service/`, `docker-compose.yml`

Current default: `EXEC_CONCURRENCY=4` (4 simultaneous Dart containers per worker).
A batch of 20 students submitting simultaneously could produce up to `20 × (code questions)` concurrent jobs.

**Action needed**: Run a rehearsal with a full 20-student batch (target: before Aug 30). Monitor container startup time, CPU/RAM headroom, queue depth. Tune accordingly.

---

## Decision 6 — Frontend Stack Change (Flutter → React)

**Status**: ✅ Resolved (2026-08-11)
**Affects**: `frontend/`, documentation

The exam UI is a **React web app** — no app installation required. Dart/Flutter remains the question domain (questions are about Dart code, displayed in Monaco Editor).

---

## Decision 7 — Screen Sharing Policy

**Status**: 🟡 Pending Teacher Decision
**Affects**: `frontend/src/components/SystemCheck.tsx`, `frontend/src/proctoring/ProctoringMediaManager.ts`

**Technical implementation is ready**: `getDisplayMedia` integration is planned in `ProctoringMediaManager`. Screen snapshots would be taken every 120 seconds and on integrity events, uploaded to S3 alongside webcam snapshots.

**Cost implication** (100 candidates, 90-min exam):
- Screen snapshots: 45 × 120 KB ≈ 5.4 MB per candidate
- Total for all 100 candidates: ~540 MB → < $0.02 on S3

**Action needed**: Teacher/exam owner to decide whether screen sharing is required exam policy. If yes, implement `getDisplayMedia` flow and add screen-share check to `SystemCheck.tsx`.

---

## Decision 8 — Evaluation Configuration Registry

**Status**: 🔴 Open — blocks coding question grading
**Affects**: `backend/src/routes/admin.js`, `grading-service/`, `compiler-service/`

The question schema stores `evaluation_config_id` (e.g. `eval_dart_sum_v1`) as an opaque reference.
The grading service must resolve this ID to its internal execution configuration.

**Questions to resolve**:
- Where does the registry live? (grading-service DB, config file, or compiler-service)
- How are evaluation configs versioned? (immutable IDs vs explicit `evaluation_config_version` field)
- What happens if an `evaluation_config_id` doesn't exist at grading time? (fail loudly or queue for retry)

**Invariant**: Once an attempt is submitted, its evaluation config must be immutable. If the compiler service changes its internal implementation for a config, the existing config ID must continue to behave identically for historical attempts.

---

## Decision 9 — AI Grading Provider

**Status**: 🔴 Open
**Affects**: `grading-service/src/graders/`

For coding and debug questions where tests are insufficient to assign partial credit, an AI model will suggest a score and rationale for teacher review.

**Options**: OpenAI GPT-4o, Google Gemini, Anthropic Claude.

**Action needed**: Pick provider. Add API key to `.env.example`. Implement stub in `grading-service/src/graders/`.

---

## Resolved Decisions (Archive)

| # | Decision | Resolved |
|---|---|---|
| 4 | Proctoring storage → AWS S3 `ap-south-1` | 2026-08-16 |
| 6 | Frontend stack → React web (not Flutter app) | 2026-08-11 |
