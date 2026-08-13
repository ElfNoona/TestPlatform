# Proctoring Service Architecture & Validation Report

This report provides a comprehensive summary of the end-to-end proctoring feature, designed and hardened for high-concurrency online exams (e.g., the 100-candidate recruitment exam scheduled for August 30). It details the system architecture, reliability patterns, security boundaries, and empirical performance metrics.

---

## 1. Executive Summary
The proctoring service tracks real-time candidate browser telemetry (e.g., tab switches, clipboard copies, paste actions) to build a dynamic cheating-risk profile. The system is designed to handle high concurrency, connection storming, and infrastructure outages gracefully without losing candidate telemetry or falsely accusing candidates of misconduct.

---

## 2. Technical Architecture & Components

```
   Candidate Browser (WS Client)
              │
              ▼
   WebSocket Server (REST API / Express)
              │
      ┌───────┴───────┐
      │               │
  Heartbeats       Actions
      │               │
      ▼               ▼
   Database        BullMQ (Ingestion Queue)
   Update             │
                      ▼
                   Workers
                      │
                      ▼
                 PostgreSQL
```

### A. Real-Time Ingestion (WebSocket Gateway)
- **Handshake Authentication**: Sockets are validated during upgrade using JSON Web Tokens (JWT) signed by a server-side secret.
- **Replacement Registry**: Sockets are managed by an active connection registry. If a student refreshes their page or opens another tab, the older connection is terminated with WS code `4009` ("Replaced by new connection") to prevent duplicate sockets.
- **Fail-Fast Outage Recovery**: Sockets operate with `enableOfflineQueue: false` on Redis connections. During Redis outages, enqueuing fails fast, and the client receives a `PROCTORING_DEGRADED` status payload, triggering local event buffering.

### B. Asynchronous Event Processing (BullMQ & Redis)
- **High-Throughput Buffer**: Actions (tab changes, copies, pastes) are enqueued to a Redis-backed BullMQ queue (`proctoring-events`) for asynchronous processing.
- **Telemetry Worker**: BullMQ workers consume events, calculate risk score changes, and persist records to PostgreSQL. Workers skip processing redundant event IDs to enforce idempotency.

### C. PostgreSQL Persistence Layer
- **`proctoring_sessions`**: Tracks session state (`ACTIVE`, `ENDED`), timestamps, and behavioral counters (`tab_switch_count`, `copy_count`, `paste_count`, `risk_score`).
- **`proctoring_events`**: Append-only log of client telemetry events. Evaluates `ON CONFLICT (proctoring_session_id, client_event_id) DO NOTHING` for worker idempotency.
- **`proctoring_incidents`**: Logs anomalies that cross warning thresholds.
- **`proctoring_session_reviews`**: Append-only audit history tracking administrative review logs.

---

## 3. Reliability & Integrity Invariants

### A. Late Event Transformations
- If a client event arrives *after* a session is finalized (`ended_at`), it is automatically transformed to `LATE_EVENT` by the processing worker.
- The original action payload is archived under metadata, and the event has **zero impact** on candidate metrics or cheating-risk scores.

### B. Idempotent Finalization
- The `endSession` HTTP API enforces a strict guard. Once a session status transitions to `ENDED`, subsequent duplicate requests preserve the initial `ended_at` timestamp.

### C. Self-Healing Gap Diagnostics
- At session finalization or retrieval, the system performs a sequence validation. Any gaps in the client sequence number chain (`sequenceNumber`) are dynamically flagged as `missingSequences` to audit missing network packets.

---

## 4. Production Security & Rate Limiting

The WebSocket gateway is protected by strict protocol guards:
- **Payload Limits**: Limits incoming text frames to `10 KB` and stringified `metadata` objects to `2 KB`.
- **Sliding-Window Throttling**:
  - **Heartbeats**: Maximum of `1 heartbeat / 8 seconds`.
  - **Actions**: Maximum of `20 actions / 5 seconds`.
- **Throttling Action**: Violations return `RATE_LIMITED` error codes with a retry recommendation (e.g., `retryAfterMs: 2000`) and do not receive an `ACK`. The connection is closed with code `4010` after 5 consecutive violations.
- **De-coupling Defenses**: Security/protocol rejections are handled at the gateway and are **never** logged as cheating incidents, protecting candidates from infrastructure errors.

---

## 5. Staging Health Route
Exposed on `/health` and `/api/v1/health`, returning:
```json
{
  "status": "healthy",
  "components": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy",
    "queue": "healthy"
  }
}
```
Exposes no sensitive environment credentials or raw code tracebacks.

---

## 6. Verification & Load-Testing Logs

### A. Core Hardening Integration Suite (`test_proctoring_hardening.js`)
- Proves sequence gap self-healing, duplicate socket closures (code `4009`), duplicate event ACKs (`"duplicate": true`), and idempotent audits.
- **Status**: **100% Passed**

### B. Resilience Suite (`test_proctoring_failures.js`)
- Simulates real-time Postgres, Redis, and worker outages.
- **Status**: **100% Passed**

### C. Security Boundaries Suite (`test_proctoring_security.js`)
- Validates expired/tampered JWT blocks, cross-talk bans, and flooding bans (code `4010`).
- **Status**: **100% Passed**

### D. Puppeteer E2E Telemetry Suite (`test_browser_socket_integration.js`)
- Drives Chromium to open `mock_exam.html`, connects over WS, triggers browser blur/copy actions, and verifies database persistence.
- **Status**: **100% Passed**

### E. Reconnect Storm Test Suite (`test_reconnect_storm.js`)
- Reconnects 100 concurrent clients after a network drop. Spacing out re-transmissions at 200ms successfully flushes buffers without triggering rate limits.
- **Status**: **100% Passed**

### F. Load & Soak Benchmark Statistics
Simulated 100 active candidates with steady traffic and database finalizations:

| Metric | Measured P50 | Measured Max / P99 | Result |
| :--- | :--- | :--- | :--- |
| **Ingestion Latency** | `6 ms` | `3434 ms` *(with simulated Redis outage)* | **Excellent** |
| **HTTP Finalization** | `47 ms` | `79 ms` | **Excellent** |
| **4-Layer Soak Audit** | 0 lost events | 0 discrepancies in risk/counters | **Verified** |

---

## 7. Rehearsal Configuration Checklist

### Nginx reverse-proxy
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

### Redis Configuration
```ini
appendonly yes
appendfsync everysec
```
