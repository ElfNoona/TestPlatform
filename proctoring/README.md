# proctoring — Post-Exam Upload Service

## Purpose

Handles video recordings that students make locally during the exam and upload after submission. **Not a live-streaming service.** Decouples the recording concern from the exam itself.

## Stack

- Node.js 20, Express 5
- `multer` — multipart file handling
- Storage adapter pattern (swap providers without changing routes)
  - `LocalAdapter` — filesystem (active, default)
  - `OciAdapter` — Oracle Cloud Block Storage (stub, not yet wired)

## How to run locally

```bash
npm install
npm run dev   # → :7000
```

Or via Docker Compose:
```bash
docker compose up proctoring -d
```

Uploaded files land in `./uploads/` (local adapter default).

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/upload` | Upload a video recording (`multipart/form-data`, field: `recording`, body: `attemptId`) |
| `GET` | `/status/:attemptId` | Check if a recording has been uploaded |
| `GET` | `/health` | Liveness probe |

## Storage adapter interface

Both adapters implement:
```js
save(attemptId, buffer, mimeType) → { location: string }
status(attemptId)                 → { exists: boolean, location?: string }
```

To switch to OCI: implement `OciAdapter.js` and change one line in `src/index.js`.

## Open TODOs

- [ ] Implement `OciAdapter` (decisions.md #4 — OCI confirmed but not wired)
- [ ] Validate `attemptId` is submitted before accepting upload
- [ ] Add student JWT auth to `/upload`
- [ ] Consider chunked upload for large recordings (>500 MB)

## How it talks to other services

```
proctoring  ←  HTTP POST from student browser (upload)
proctoring  →  local filesystem (or OCI when wired)
```
