# Pre-Event Proctoring Media Readiness Checklist (August 30 Exam)

This checklist outlines the remaining validation and verification steps required to ensure operational readiness for the one-time 100-candidate recruitment exam scheduled for August 30.

---

## 🔴 Must Complete Before August 30 (Critical Path)

### [ ] 1. Real R2 Upload ➔ Download ➔ Delete Smoke Test
Verify that the complete object lifecycle functions under production S3-compatible credentials.
- **Workflow to test**: Presigned PUT URL ➔ Client PUT Upload ➔ HEAD Verification ➔ Presigned GET URL ➔ Client GET Download ➔ Delete Object.
- **Safety check**: Ensure the test script uses a unique, disposable object key and implements a `finally` block to always delete the test object, preventing orphaned files.

### [ ] 2. Production R2 Credentials & Configuration Verification
- Ensure that credentials are set securely in the environment variables without being checked into Git or stored in `.env` files inside code repos.
- **Fail-Fast Safeguard**: Implement a check on startup to throw a fatal error and crash the application if `MEDIA_STORAGE_PROVIDER=r2` is set but any required keys (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) are missing or empty. This prevents silent fallbacks to local storage in production.

### [ ] 3. Production R2 CORS Domain Verification
Confirm the R2 bucket CORS policy restricts origins to the narrowest possible access.
- **Target Policy**:
  - **Allowed Origins**: `https://your-production-exam-domain.com` (Do NOT use `*` in production).
  - **Allowed Methods**: `GET`, `PUT`, `HEAD`.
  - **Allowed Headers**: `Content-Type`, `Content-Length`. (Restrict authorization headers if they are already embedded in the presigned query params).
- **Verification**: Run preflight checks via simulated curl OPTIONS requests and test direct PUT upload streams.

### [ ] 4. Production Database Migration Audit
Confirm that migrations run successfully on the live database before testing.
- **Schema audit**: Verify `proctoring_media` table, foreign keys, and indices are present.
- **Indices to verify**:
  - `idx_proctoring_media_session` on `proctoring_session_id`
  - `idx_proctoring_media_event` on `proctoring_event_id`
  - `idx_proctoring_media_expires` on `expires_at` (conditional index where not null)

### [ ] 5. 100-Candidate Concurrency & Load Test
Verify the system's performance under realistic workload conditions.
- **Target load**: Simulate 100 concurrent candidates, each uploading 1 webcam snapshot (approx. 250 KB) every 60 seconds over a 90-minute period (totaling ~9,500 uploads).
- **Metrics to monitor**:
  - P50, P95, and P99 upload latency.
  - Zero unexplained 5xx errors on `/upload-url` and `/complete` endpoints.
  - Database connection pool utilization.
  - Application CPU and memory growth profiles.

### [ ] 6. Real-Device Webcam Test
Verify browser permissions and capture pipeline behavior on at least one physical, non-headless machine matching a candidate's typical laptop setup.
- **Verify**: Correct prompt trigger for camera access, canvas image capture, JPEG quality resolution (~70-80% rendering ~250 KB size), and successful REST API upload over HTTPS.

### [ ] 7. Confirm MEDIA_RETENTION_DAYS
Ensure the retention parameter is explicitly set in production environments.
- **Action**: Explicitly declare `MEDIA_RETENTION_DAYS=30` (or the institution's agreed period) in the production environment variables, rather than relying on default logic.

---

## 🟡 Strongly Recommended (Best Practices)

### [ ] 8. Automated Presigned URL Expiration Test
Ensure the storage provider rejects expired links without waiting manually.
- **Test flow**: Generate a URL with `expiresIn: 2` (2 seconds), wait 3 seconds, and assert that a PUT request results in a `403 Forbidden` response from the storage provider.

### [ ] 9. Cleanup Worker Logging, Idempotency & DB Limits
- **Logging**: Monitor worker logs to confirm successful S3 deletion events and matching database updates.
- **Idempotency**: Verify that R2/S3 deletion is idempotent. If two nodes attempt to delete the same key, it must not throw errors or crash the process.
- **Limits**: Verify PostgreSQL connection limits and application settings are configured to accommodate 100 concurrent connections gracefully.

---

## 🟢 Already Demonstrated (Verified via Integration Tests)
- [x] Storage adapter abstraction interface.
- [x] Local storage fallback simulator for offline testing.
- [x] Media metadata persistence with PostgreSQL.
- [x] Candidate authorization isolation guards (cross-talk blocks).
- [x] Teacher authorization roles and viewing audit logs.
- [x] Presigned upload and download workflow logic.
- [x] Media completion and head-check verification states.
- [x] Session media timeline listings.
- [x] Bounded browser queue and best-effort media priority logic.
- [x] Expired media identification and DB state transitions.
