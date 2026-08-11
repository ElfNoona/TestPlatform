# Open Decisions

This file tracks architectural and product decisions that are **not yet resolved**.  
Each decision blocks or constrains implementation work — do not implement the affected area until the decision is made and this file is updated.

Last updated: 2026-08-11

---

## Decision 1 — Teacher Auth Mechanism

**Status**: 🔴 Open  
**Affects**: `backend/src/routes/teacherAuth.js`, `backend/src/middleware/auth.js`, `grading-service/src/routes/review.js`

**Options under consideration**:
- **Magic link** — teacher enters their email, receives a time-limited sign-in link. Simpler, no OAuth app setup needed.
- **Google OAuth (allowlist)** — teacher signs in with Google, backend verifies email is in `TEACHER_ALLOWLIST_EMAILS`. More familiar UX, requires Google Cloud app registration.

**Action needed**: Pick one. Update `TEACHER_AUTH_PROVIDER` in `.env.example` and implement the chosen flow.

---

## Decision 2 — Grading UI

**Status**: 🔴 Open  
**Affects**: `grading-service/`, potentially `frontend/`

The teacher review/override API is stubbed in `grading-service/src/routes/review.js`.  
The UI for teachers to view AI-suggested grades and override them is **not yet scoped**.

**Questions to resolve**:
- Is this a separate admin web app, or added to the existing `frontend/`?
- What information does a teacher need to see per question (code diff? compiler output?)?
- Is batch approval of AI grades needed, or single-question override only?

---

## Decision 3 — Screenshot Capture for Widget-Test Grading

**Status**: 🟡 Proposed (not confirmed)  
**Affects**: `compiler-service/`, `grading-service/`

For Flutter widget tests, capturing a screenshot as a secondary grading artifact  
(compare rendered widget to reference image) was recommended.

**Questions to resolve**:
- Is widget rendering in scope for this exam (pure Dart logic questions only, or also Flutter UI)?
- If yes: screenshot capture requires a display server in the sandbox (Xvfb or similar) — significant complexity.
- Confirmed: this is currently **not included** in the scope. Re-evaluate after Aug 30 rehearsal.

---

## Decision 4 — Proctoring Storage Provider

**Status**: 🟡 Lean confirmed, not wired  
**Affects**: `proctoring/src/adapters/OciAdapter.js`

**Current lean**: Oracle Cloud Infrastructure (OCI) Object Storage — 200 GB free block storage tier.

**What's needed to implement**:
1. Create an OCI account + bucket
2. Generate S3-compatible access key pair
3. Implement `OciAdapter.save()` and `OciAdapter.status()` (interface documented in `proctoring/src/adapters/OciAdapter.js`)
4. Fill in `OCI_NAMESPACE`, `OCI_BUCKET`, `OCI_ACCESS_KEY`, `OCI_SECRET_KEY` in `.env`
5. Swap `LocalAdapter` → `OciAdapter` in `proctoring/src/index.js`

**Action needed**: Confirm OCI, then assign implementation.

---

## Decision 5 — `EXEC_CONCURRENCY` for Compiler Service

**Status**: 🟡 Unvalidated  
**Affects**: `compiler-service/`, `docker-compose.yml`

Current default: `EXEC_CONCURRENCY=4` (4 simultaneous Dart containers per worker).  
A batch of 20 students all submitting code answers simultaneously could produce  
up to 20 × (number of code questions) concurrent jobs.

**Action needed**:
- Run a rehearsal with a full 20-student batch (target: before **Aug 30**)
- Monitor: container startup time, host CPU/RAM headroom, queue depth
- Tune `EXEC_CONCURRENCY` and `Memory` / `NanoCpus` limits in `compiler-service/worker/src/index.js` accordingly

---

## Decision 6 — Frontend Stack Change (Flutter → React)

**Status**: ✅ Decided (2026-08-11)  
**Affects**: `frontend/`, documentation

The exam UI has been **changed from Flutter (app) to React (web)**.  
Students access the exam via a browser — no app installation required.

**Rationale**: Web-only exam removes app distribution complexity for a ~100 student cohort.  
Dart/Flutter is still the **question domain** (questions are about Dart code, displayed in Monaco Editor with Dart syntax highlighting).

Any prior references to "Flutter frontend" or "Flutter exam app" in project notes are superseded by this decision.

---

## Resolved Decisions (archive)

_(none yet — move items here once closed)_
