# Architecture Decisions and Limitations

## General

### PostgreSQL as Source of Truth
Elasticsearch is a rebuildable search index, not the authoritative database.
All writes go to PostgreSQL first. If Elasticsearch indexing fails, the email
is still safely persisted in Postgres. The rebuild endpoint (`POST /api/search/rebuild`)
can resync the index from Postgres at any time.

### Monorepo Structure
Chosen to share TypeScript types, keep CI simple, and allow packages to be
developed in lockstep. The trade-off is a heavier `node_modules` at the root.

---

## Milestone 4 — Distributed Rate Limiting

**Decision**: Redis Lua scripts for atomic counter + timestamp operations.

**Limitation**: Rate limits are scoped per `userId` or globally depending on
`RATE_LIMIT_SCOPE`. There is no per-recipient or per-domain throttling.

If Redis is unavailable, the worker rejects the rate-limit check and re-queues
the job rather than sending without checking.

---

## Milestone 5 — SMTP Reliability

**Decision**: Atomic `updateMany WHERE status='PROCESSING'` prevents stale
workers from overwriting FAILED/CANCELLED with SENT.

**Known Race Window**: There is an unavoidable gap between the final ownership
check and the SMTP call. If the lease expires during SMTP, the email may be
delivered but the worker will detect ownership loss on persistence and log
`AMBIGUOUS_DELIVERY_STALE_WORKER`. This requires operator review.

**Limitation**: Exactly-once delivery is not guaranteed. The system prevents
duplicate sends where possible, but the SMTP-in-flight window cannot be
fully eliminated without distributed transaction support across SMTP providers.

---

## Milestone 6 — Google OAuth

**Decision**: Server-side OAuth with HTTP-only session cookies rather than
client-side tokens. This prevents token theft via XSS.

**Limitation**: In development without GOOGLE_CLIENT_ID, the API falls back
to a deterministic dev user (`dev@reachinbox.local`). This is not a security
bypass in production because the `requireAuth` middleware checks the session.

---

## Milestone 8 — Slack Alerting

**Decision**: Rate-limit alert deduplication via Redis `SET NX EX 300`
(5-minute window per userId scope). This prevents notification storms.

**Limitation**: If Redis is unavailable, Slack alerts are silently skipped.
The email processing path is not affected.

**Limitation**: Slack incoming webhooks bypass OAuth and have no user identity.
Direct webhook configuration is a convenience feature and is user-controlled.

---

## Milestone 9 — Elasticsearch & BullMQ Dashboard

**Decision**: ES indexing is fire-and-forget in both the API and worker.
Failures are logged and swallowed. The write path (Postgres) is never blocked.

**Decision**: `GET /api/search/emails` falls back to a Postgres `ILIKE` query
if Elasticsearch is unavailable. The response includes a `source` field
indicating whether ES or Postgres was used.

**Decision**: Index rebuild (`POST /api/search/rebuild`) drops and recreates
the index. This is safe because Postgres is the source of truth.

**Limitation**: The Elasticsearch cluster configured here is a single-node
development cluster (`discovery.type=single-node`). For production, a
multi-node cluster with replicas and TLS is required.

**Limitation**: Elasticsearch 8.x with `xpack.security.enabled=false` disables
authentication. In production, enable security and configure API keys or
username/password authentication.

**Decision**: The BullMQ dashboard (`/admin/queues`) is:
- Development: accessible from `localhost` only (no token required).
- Production: requires `X-Admin-Token` header matching `ADMIN_TOKEN` env var.
  If `ADMIN_TOKEN` is not set in production, the dashboard is disabled.

**Limitation**: The Bull Board dashboard provides read-only job visibility.
Destructive operations (drain, delete all) are not exposed through the API.
Direct Redis access would be required for those operations.

**Limitation**: The search index is not updated in real time when the worker
quarantines a stale email as FAILED (the quarantine path doesn't fetch the full
email object to avoid extra queries in the hot path). The rebuild endpoint
or the API-side delete hook handles index cleanup for deleted emails.
