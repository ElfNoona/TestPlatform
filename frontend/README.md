# frontend — React Exam UI

## Purpose

Student-facing web app for taking timed Dart/Flutter coding exams. No app installation required — runs entirely in the browser.

## Stack

- React 18 + Vite + TypeScript
- `@monaco-editor/react` (Monaco Editor) — code editor with Dart syntax
- React Router v6
- React Context + hooks for state management

## Screens

| Route | Component | Status |
|---|---|---|
| `/login` | `LoginPage` | Stubbed — API call wired, JWT storage TODO |
| `/exam/:attemptId` | `ExamPage` | Stubbed — polling, layout, MCQ/editor rendering |
| `/submit-confirm` | `SubmitConfirmPage` | Stubbed |

## How to run locally

```bash
npm install
npm run dev          # → http://localhost:5173
```

The Vite dev server proxies `/api/*` → `http://localhost:4000`.  
The backend must be running (or via `docker compose up backend`).

## Key design decisions

- **Timer is cosmetic**: `ExamTimer` counts down locally but `ExamPage` polls
  `GET /api/attempts/:id/state` every 30 s for the authoritative remaining time.
  The server enforces the cutoff — the client cannot manipulate it.
- **JWT in memory**: tokens are NOT stored in `localStorage` — they live in
  `AuthContext` state only. Refreshing the page requires re-login.
- **Code editor**: Monaco with `defaultLanguage="dart"`. Dart grammar registration
  is a **TODO** — see `QuestionRenderer.tsx`.

## Open TODOs

- [ ] Register Dart TextMate grammar in Monaco
- [ ] Implement autosave (debounced POST to `/answers`)
- [ ] Wire `AuthContext` token into `api.ts` requests
- [ ] Add auth guard HOC / route protection
- [ ] Teacher/grading review UI (not yet scoped — see `docs/decisions.md`)

## How it talks to other services

```
frontend → backend :4000  (all /api/* calls via Vite proxy in dev)
```
