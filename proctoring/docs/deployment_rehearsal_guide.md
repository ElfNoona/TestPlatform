# Proctoring Production Deployment & Rehearsal Guide

This guide details the network topology, server configurations, database backup policies, and Redis recovery strategies required for a resilient production deployment of the proctoring service.

---

## 1. Network Topology & Nginx Proxy Configuration

```
      Internet (Candidates)
                │
                ▼
      Reverse Proxy / Load Balancer (Nginx)
                │
         ┌──────┴──────┐
         ▼             ▼
      Node.js HTTP API & WebSocket Server
         │             │
         ▼             ▼
     PostgreSQL     Redis (Queue & Rate Limits)
```

### Nginx WebSocket Proxy Block
To prevent intermediate proxies or load balancers from closing idle WebSocket connections prematurely (standard default is often 60 seconds), Nginx must be explicitly configured with long connection timeouts and correct upgrade headers.

Add the following location block to your Nginx virtual host configuration:

```nginx
server {
    listen 80;
    server_name proctor.example.com;

    # Redirect to SSL in production
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name proctor.example.com;

    ssl_certificate /etc/letsencrypt/live/proctor.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/proctor.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000; # Node.js server address
        
        # Enable HTTP/1.1 and upgrade headers for WebSocket handshake
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Pass client headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CRITICAL: Prevent proxy timeouts from killing long-lived sockets
        # Keeps connections open for up to 1 hour of inactivity (heartbeats will keep it hot)
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        # Buffer settings
        proxy_buffering off;
    }
}
```

---

## 2. PostgreSQL Backup & Verification Strategy

To guarantee zero data loss of audit history and session summary records:

### Backup Procedure
Automate nightly PostgreSQL backups using a Cron job running `pg_dump`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/postgres"
DB_NAME="proctoring_db"
DB_USER="postgres"
DATE=$(date +%Y-%m-%d_%H%M%S)

# Perform gzipped schema + data dump
pg_dump -U $DB_USER -h localhost -d $DB_NAME | gzip > "$BACKUP_DIR/proctoring_backup_$DATE.sql.gz"

# Retain backups for 14 days
find $BACKUP_DIR -type f -name "*.sql.gz" -mtime +14 -delete
```

### Verification Procedure
1. Set up a staging database container during deployment rehearsals.
2. Restore the backup:
   ```bash
   gunzip -c proctoring_backup_2026-08-30_020000.sql.gz | psql -U postgres -d restore_db
   ```
3. Run a checksum test:
   ```sql
   SELECT count(*) FROM proctoring_events;
   ```
   Confirm row counts match production active state before finalization.

---

## 3. Redis Persistence & Recovery Strategy

Since Redis manages both the rate-limiting buckets and the BullMQ event ingestion queue, memory-only settings are unsafe.

### Configuration (`redis.conf`)
Enable **Append Only File (AOF)** persistence to log every write command, ensuring minimal data loss during sudden crashes:

```ini
# Enable AOF Persistence
appendonly yes

# Sync write buffer to disk every second (standard compromise between speed and security)
appendfsync everysec

# Auto rewrite the AOF file when size increases by 100% (min 64mb)
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

### Recovery Check
During container restarts, Redis will automatically rebuild state using the `appendonly.aof` log, preserving enqueued proctoring jobs waiting to be processed by workers.

---

## 4. Reconnect Storm & Soak Rehearsal Guidelines

Before August 30, execute these verification drills:

1. **Proxy Timeout Drill**:
   - Establish a WebSocket connection.
   - Pause sending heartbeats for 5 minutes.
   - Verify the connection is NOT dropped by Nginx (the 3600s timeout keeps it alive).
2. **60-Minute Soak Test**:
   - Run the soak test against the reverse-proxy endpoint:
     ```bash
     node scratch/test_proctoring_soak.js --duration=3600
     ```
   - Monitor the system memory (heap usage) to confirm no resource leakage.
3. **100-User Storm Connect Test**:
   - Point the storm connect test to the deployed Nginx entry point.
   - Verify that all connections upgrade and authenticate without throttling failures.
