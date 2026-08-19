# frontend — React Exam UI & Teacher Dashboard

## Purpose

Serves two audiences:

- **Candidates** — timed exam runner with Monaco code editor, autosave, real-time proctoring client, and a mandatory pre-exam system-check flow.
- **Teachers** — session review dashboard showing candidate timelines, R2 evidence snapshots, and integrity decision tools.

---

## Stack

- React 18 + Vite + TypeScript
- `@monaco-editor/react` — Monaco Editor with Dart syntax highlighting
- React Router v6
- React Context + hooks for global auth and proctoring state

---

## Screens

| Route | Component | Status |
|---|---|---|
| `/login` | `LoginPage` | ✅ Implemented — access code → JWT |
| `/splash/:attemptId` | `SplashScreen` | ✅ Implemented — pre-exam countdown |
| `/exam/:attemptId` | `ExamPage` | ✅ Implemented — SystemCheck → exam |
| `/submit-confirm` | `SubmitConfirmPage` | ✅ Implemented |
| `/teacher` | `TeacherDashboard` | 🔴 Planned — candidate list, risk matrix |
| `/teacher/session/:id` | `TeacherSessionView` | 🔴 Planned — timeline + evidence viewer |
| `/teacher/question-sets` | `QuestionUpload` | 🔴 Planned — upload & manage questions |

---

## Proctoring Client Architecture

The candidate's proctoring subsystem lives in `src/proctoring/` and is composed of focused, independently-testable modules:

```
useProctoring (React hook)
    │
    └── ProctoringManager
              │
              ├── ProctoringSocket     — WS connection, JWT handshake, exponential backoff
              │       └── EventBuffer  — localStorage-backed pending event queue (session-scoped)
              │
              ├── HeartbeatManager     — standalone heartbeat timer, decoupled from React renders
              │
              └── ProctoringMediaManager — webcam/screen capture, R2 presigned upload flow
```

### Event Lifecycle

```
Event generated (browser telemetry)
      ↓
EventBuffer.addEvent (localStorage, keyed by sessionId)
      ↓
ProctoringSocket.send (WebSocket, if OPEN)
      ↓
Server ACK received
      ↓
EventBuffer.ackEvent (removes from buffer)
```

On page refresh:
```
localStorage (pending events survive page destroy)
      ↓
new page load → ProctoringManager.start()
      ↓
EventBuffer.getPendingEvents() → flush at 200ms spacing
      ↓
Server ACKs → buffer cleared
```

### Pre-Exam System Check

Before entering the exam, `SystemCheck.tsx` enforces:

| Check | What it verifies |
|---|---|
| Browser compatibility | `navigator.mediaDevices.getUserMedia` available |
| Internet connectivity | `navigator.onLine` |
| Backend reachability | `GET /api/attempts/:id/state` returns 200 |
| WebSocket connectivity | Opens a real WS connection to `proctoring :7000`, waits for `CONNECTED` |
| Camera permission | `getUserMedia` granted, live preview shown |
| Screen share permission | `getDisplayMedia` granted (if exam policy requires it) |
| Fullscreen capability | `document.fullscreenEnabled` check |

---

## How to Run Locally

```bash
npm install
npm run dev          # → http://localhost:5173
```

The Vite dev server proxies:
- `/api/*` → `http://localhost:4000` (backend)
- WebSocket connections to `:7000` must be configured in `vite.config.ts` or handled via the proctoring origin env var.

---

## Key Design Decisions

- **Server-authoritative timer**: `ExamTimer` derives its display from the server-provided `remainingSeconds` on each 30s poll. The client cannot manipulate the deadline.
- **JWT in memory only**: Tokens live in `AuthContext` React state. They are NOT stored in `localStorage`. A page refresh requires re-login (candidate returns to access code screen).
- **EventBuffer is session-scoped**: Storage keys include `sessionId` to prevent one candidate's buffered events leaking into another's session.
- **Media failure ≠ exam failure**: `captureFinalSnapshot` on submission is fire-and-forget. A failed upload does not block the submit flow.
- **Heartbeats are React-independent**: `HeartbeatManager` runs on a standalone `setInterval` owned by `ProctoringManager`, not inside any React component. React re-renders and question navigation do not spawn duplicate timers.

---

## Open TODOs

- [ ] Register Dart TextMate grammar in Monaco (`QuestionRenderer.tsx`)
- [ ] Add WebSocket reachability check to `SystemCheck.tsx`
- [ ] Implement `/teacher` dashboard — candidate list, risk scoring display
- [ ] Implement `/teacher/session/:id` — timeline, R2 snapshot viewer, integrity decision form
- [ ] Implement `/teacher/question-sets` — bulk JSON upload, template cards per question type
- [ ] Server-authoritative timer offset synchronisation (sync local clock to `endsAt` on each poll)

---

## How it Talks to Other Services

```
frontend → backend :4000        (all /api/* via Vite proxy in dev)
frontend → proctoring :7000     (WebSocket ws:// + media REST /api/v1/*)
```
