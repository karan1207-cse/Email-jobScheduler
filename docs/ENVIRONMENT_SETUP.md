# ReachInbox Email Job Scheduler — Environment Configuration Guide

This document provides a comprehensive reference for all configuration variables utilized across the ReachInbox Email Job Scheduler monorepo (`apps/api`, `apps/worker`, `apps/web`, and Docker Compose).

---

## Configuration Matrix

| Variable | Target Service | Requirement Level | Default Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | API, Worker | Optional | `development` | Runtime environment (`development`, `test`, `production`). Governs error formatting, cookie security, and local dev fallbacks. |
| `PORT` | API | Optional | `5000` | Port for the Express REST API and Bull Board dashboard. |
| `FRONTEND_URL` | API | Optional | `http://localhost:5173` | Allowed origin for CORS and destination for OAuth callback redirects. |
| `DATABASE_URL` | API, Worker | **Required** | `postgresql://reachinbox:reachinbox_secret@localhost:5432/reachinbox_db` | PostgreSQL connection URI for Prisma ORM. |
| `POSTGRES_USER` | Docker / Infra | Optional | `reachinbox` | PostgreSQL superuser for Docker Compose initialization. |
| `POSTGRES_PASSWORD` | Docker / Infra | Optional | `reachinbox_secret` | PostgreSQL superuser password for Docker Compose. |
| `POSTGRES_DB` | Docker / Infra | Optional | `reachinbox_db` | PostgreSQL database name for Docker Compose. |
| `POSTGRES_PORT` | Docker / Infra | Optional | `5432` | Exposed host port for PostgreSQL container. |
| `REDIS_URL` | API, Worker | **Required** | `redis://localhost:6379` | Redis connection URI for BullMQ queues, rate limiting, and alert deduplication. |
| `REDIS_PORT` | Docker / Infra | Optional | `6379` | Exposed host port for Redis container. |
| `WORKER_CONCURRENCY`| Worker | Optional | `5` | Maximum number of concurrent jobs processed by a single worker instance. |
| `RATE_LIMIT_MAX_PER_HOUR` | Worker | Optional | `100` | Hourly transmission limit. Set to `0` for unlimited. |
| `RATE_LIMIT_INTERVAL_MS` | Worker | Optional | `1000` | Minimum spacing interval (in ms) between consecutive email dispatches. |
| `RATE_LIMIT_SCOPE` | Worker | Optional | `global` | Scope for rate limit enforcement: `global` (shared cluster limit) or `per-sender` (tenant/user isolated). |
| `RATE_LIMIT_KEY_PREFIX` | Worker | Optional | `rl:reachinbox` | Key namespace prefix for Redis rate-limiting keys and locks. |
| `EMAIL_QUEUE_NAME` | API, Worker | Optional | `email-jobs` | BullMQ queue identifier shared between API producers and worker consumers. |
| `SESSION_SECRET` | API | Required in Prod | `dev-session-secret-change-in-production` | Secret used to sign session cookies for Google and Slack state validation. |
| `GOOGLE_CLIENT_ID` | API | Optional (Dev) / Required (Prod) | *empty* | OAuth 2.0 Client ID from Google Cloud Console. In dev, falls back to deterministic dev user if empty. |
| `GOOGLE_CLIENT_SECRET` | API | Optional (Dev) / Required (Prod) | *empty* | OAuth 2.0 Client Secret from Google Cloud Console. |
| `GOOGLE_REDIRECT_URI` | API | Optional | `http://localhost:5000/auth/google/callback` | Authorized redirect URI configured in Google Developer Console. |
| `SLACK_CLIENT_ID` | API | Optional (Dev) / Required (Prod) | *empty* | Slack App Client ID from api.slack.com. When unset, Slack OAuth endpoints yield HTTP 503. |
| `SLACK_CLIENT_SECRET` | API | Optional (Dev) / Required (Prod) | *empty* | Slack App Client Secret. |
| `SLACK_REDIRECT_URI` | API | Optional | `http://localhost:5000/auth/slack/callback` | OAuth redirect URI configured in Slack App settings. |
| `ELASTICSEARCH_URL`| API, Worker | Optional | `http://localhost:9200` | HTTP endpoint for Elasticsearch 8.x cluster. If unreachable, API falls back to PostgreSQL. |
| `ELASTICSEARCH_INDEX`| API, Worker | Optional | `reachinbox_emails` | Name of the primary Elasticsearch index. |
| `ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED` | API, Worker | Optional | `true` | Set to `false` only if connecting to self-signed TLS development clusters. |
| `ADMIN_TOKEN` | API | Recommended | *empty* | Secret token required for `/api/search/rebuild` and `/admin/queues` in production. If unset, routes are localhost-only. |
| `SMTP_HOST` | Worker | Optional | *empty* | Production SMTP server host. If unset, worker automatically provisions an Ethereal test account. |
| `SMTP_PORT` | Worker | Optional | `587` | Production SMTP port. |
| `SMTP_SECURE` | Worker | Optional | `false` | Use TLS (`true` for port 465, `false` for 587/STARTTLS). |
| `SMTP_USER` | Worker | Optional | *empty* | SMTP authentication username. |
| `SMTP_PASS` | Worker | Optional | *empty* | SMTP authentication password. Never logged in plain-text. |
| `SMTP_FROM` | Worker | Optional | `"ReachInbox Scheduler" <scheduler@reachinbox.local>` | Default `From` address header for outgoing emails. |
| `VITE_API_URL` | Web (Vite) | Optional | `http://localhost:5000` | Base URL used by the React web frontend to reach backend endpoints. |

---

## Production Security Notes

1. **`SESSION_SECRET`**: Must be generated using a cryptographically secure random value (e.g. `openssl rand -hex 32`) in production environments.
2. **`ADMIN_TOKEN`**: Required in non-local production deployments. The queue dashboard (`/admin/queues`) and index rebuild endpoint (`/api/search/rebuild`) will reject external requests with `403 Forbidden` unless authorized with `X-Admin-Token: <token>`.
3. **SMTP Credentials**: When running in production, always provide dedicated SMTP relay credentials (SendGrid, Postmark, AWS SES, or corporate SMTP). If left blank, the worker falls back to creating transient Ethereal test accounts.
4. **Elasticsearch Security**: For production, deploy Elasticsearch with TLS enabled and specify authenticated URLs (`http://elastic:password@host:9200`).
