# Proctoring & Telemetry Service

This service provides real-time browser telemetry ingestion and proctoring controls for online assessments, alongside post-exam video recording uploads. It is designed to handle high concurrency (e.g., 100+ concurrent candidates) with robust data integrity, outage resilience, and rate-limiting security guards.

---

## 1. System Architecture

The service uses a fast-ingestion, asynchronous processing architecture to ensure WebSocket operations are non-blocking:

```mermaid
graph TD
    Client[Browser WebSocket Client] -->|Telemetry / Heartbeats| WS[WebSocket Gateway]
    WS -->|Authorize JWT / Apply Rate Limits| Sec{Security & Rate Limiter}
    Sec -->|Reject: Invalid Token / 4010 Flood| Log[Security Audit Logs]
    Sec -->|Valid Heartbeat| DB[(PostgreSQL)]
    Sec -->|Valid Action Event| Redis[(Redis / BullMQ Queue)]
    Redis --> Worker[Event Processing Worker]
    Worker -->|Calculate Risk Scores & Counters| DB
```

### Ingestion Flow
1. **WebSocket Handshake**: Client initiates upgrade providing a signed JWT candidate token.
2. **Replacement Registry**: If a duplicate connection is opened (e.g., from tab refreshes), the registry closes the older socket using code `4009`.
3. **Queue Separation**: Heartbeats update PostgreSQL directly to keep connection metrics fresh. Telemetry actions are pushed to the Redis `proctoring-events` BullMQ queue.
4. **Worker Persistence**: Workers process enqueued telemetry, check for duplicate event IDs, calculate risk increments, and persist results to Postgres.

---

## 2. Security & Rate Limiting Engine

To protect the server from flooding and message exploitation, the WebSocket gateway applies real-time validation:

```mermaid
flowchart TD
    A[Incoming Message] --> B{Payload Size < 10KB?}
    B -- No --> C[Close Connection code: 4008]
    B -- Yes --> D{Metadata Size < 2KB?}
    D -- No --> C
    D -- Yes --> E{Event Type?}
    E -- HEARTBEAT --> F{Heartbeats in 8s < 1?}
    E -- ACTION --> G{Actions in 5s < 20?}
    F -- No --> H[Send RATE_LIMITED, Violation++]
    G -- No --> H
    H --> I{Consecutive Violations >= 5?}
    I -- Yes --> J[Terminate Connection code: 4010]
    I -- No --> K[Continue Listening]
    F -- Yes --> L[Update DB Heartbeat / HEARTBEAT_ACK]
    G -- Yes --> M[Enqueue to BullMQ / ACK]
```

### Decoupling Infrastructure Failures from Misconduct
*   **Protocol Security Events** (`RATE_LIMITED`, `INVALID_JWT`, `SESSION_MISMATCH`, `PAYLOAD_TOO_LARGE`) are blocked at the gateway, bypass workers/queues, and **never** update candidate risk scores.
*   **Proctoring Incidents** (`TAB_HIDDEN`, `COPY`, `PASTE`) represent behavioural telemetry and updates the candidate's cheating-risk timeline.

---

## 3. Reliability & Data Integrity Invariants

| Invariant | Problem Solved | Technical Resolution |
| :--- | :--- | :--- |
| **Late Event Transformation** | Events arriving after attempt finalization artificially inflation risk scores. | Worker transforms post-exam events into `LATE_EVENT`, preserving the original payload in metadata with no risk score changes. |
| **Idempotency Safeguard** | Worker reprocessing or client retries double-counting anomalies. | PostgreSQL unique constraint `(proctoring_session_id, client_event_id)` triggers `ON CONFLICT DO NOTHING`. |
| **Idempotent Finalization** | Repeated HTTP submissions updating attempt end times. | `endSession` locks the initial `ended_at` timestamp using `COALESCE(ended_at, now())`. |
| **Sequence Gap check** | Network drops causing packets loss undetected. | Dynamic query-time sequence analytics calculations to identify missing `sequenceNumber` gaps. |

---

## 4. REST API Endpoint Registry

### Public Endpoints (Authentication Optional)
*   **`GET /health`** / **`GET /api/v1/health`**: Production health checks. Exposes components connectivity without credentials or trace leaks.
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

### Internal/Teacher APIs (Require Token/Service Auth)
*   **`POST /internal/sessions`**: Create a proctoring session (called when student starts exam).
*   **`POST /internal/sessions/:id/end`**: Ends the session and stores initial `ended_at` timestamp.
*   **`GET /api/v1/sessions/:id/summary`**: Retrieves session telemetry counters, risk metrics, and sequence gap arrays.
*   **`POST /api/v1/sessions/:id/reviews`**: Append-only administrative session reviews and decisions.

---

## 5. Verification Test Suites

Verify changes locally using the test scripts under the `scratch/` directory:

```bash
# 1. Verify Core Hardening logic (registry, gaps, finalization)
node scratch/test_proctoring_hardening.js

# 2. Verify WebSocket Security & Rate Limits (floods, expiration)
node scratch/test_proctoring_security.js

# 3. Verify E2E Browser Telemetry connection (Puppeteer automation)
node scratch/test_browser_socket_integration.js

# 4. Verify 100-User Storm connection (200ms spaced flushing)
node scratch/test_reconnect_storm.js

# 5. Run load soak test with 4-Layer Reconciliation validation
node scratch/test_proctoring_soak.js --duration=60
```
