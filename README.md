# ReachInbox — Distributed Full-Stack Email Job Scheduler

Production-grade, distributed email scheduling platform engineered with React 18, Vite, Node.js, Express, TypeScript, PostgreSQL (Prisma ORM), Redis 7 (BullMQ), Elasticsearch 8, and Nodemailer.

---

## 1. Project Overview & Problem Statement

High-volume email outreach demands strict delivery guarantees:
- **Zero duplicate sends**: Concurrent workers must never deliver the same message twice.
- **Accurate scheduling**: Time-delayed delivery must survive API crashes, worker reboots, and network partitions.
- **Provider rate compliance**: Hourly sending caps and pacing intervals must be coordinated atomically across independent worker processes.
- **Delivery ambiguity resolution**: When an SMTP connection drops mid-transmission, systems must avoid naive automatic retries that cause duplicate customer emails.
- **Multi-tenant security**: User data, leads, search results, and Slack alerts must remain strictly isolated per tenant.

ReachInbox solves these challenges through a resilient, decoupled architecture combining a **Transactional Outbox Pattern**, **distributed Redis Lua sliding-window rate limiters**, **lease-based worker claims**, **Elasticsearch read-side indexing with Postgres fallback**, and **server-side Google & Slack OAuth 2.0**.

---

## 2. Key Features

- **Durable Delayed Scheduling**: Sub-second accurate email dispatch using BullMQ and Redis sorted sets without polling cron jobs.
- **Transactional Outbox Pattern**: Atomic database transactions commit email records and outbox events together before queue dispatch.
- **Distributed Rate Limiting & Pacing**: Atomic Redis Lua scripts enforce global/per-sender hourly quotas and minimum intervals between consecutive sends across multiple worker instances.
- **Sentinel Deferrals via `DelayedError`**: Over-limit jobs are deferred using BullMQ's native delayed mechanism without consuming retry attempts or marking jobs as failed.
- **SMTP Reliability & Quarantine**: Ethereal test SMTP integration with web preview URLs. Post-send DB failures undergo localized retries; ambiguous results enter operator quarantine to prevent blind duplicates.
- **Google OAuth 2.0 & Multi-User Isolation**: Server-side authentication with HTTP-only, SameSite=Lax session cookies. All endpoints, queries, and search indices enforce strict `userId` tenant scoping.
- **Rich Campaign Composer**: React 18 + Vite frontend with live lead CSV/TXT parsing, deduplication, syntax validation, scheduled/sent tabs, and real-time countdown badges.
- **Slack OAuth 2.0 & Alert Deduplication**: Automated alerts on rate limit thresholds, deduplicated via Redis `SET NX EX 300` to prevent channel notification spam.
- **Elasticsearch 8 Full-Text Search**: Sub-millisecond full-text search across subject, body, and recipients with status filters, date ranges, and automatic fallback to PostgreSQL if Elasticsearch is offline.
- **BullMQ Queue Dashboard**: Embedded Bull Board UI (`/admin/queues`) protected by localhost IP checks in development and `X-Admin-Token` authentication in production.
- **1,000-Job Load Tested**: Repeatable load verification proving zero lost jobs, zero duplicates, and clean mid-stream crash recovery.

---

## 3. Technology Stack

| Layer | Technologies |
|---|---|
| **Monorepo** | npm workspaces, TypeScript 5.8 |
| **API Server** | Node.js (v20+ / v24+), Express 4, TypeScript, Prisma ORM 6, Zod, Supertest |
| **Worker Process** | BullMQ 6, ioredis 5, Nodemailer 6 |
| **Frontend** | React 18, Vite 6, TypeScript, Lucide Icons, Modern Vanilla CSS Tokens |
| **Primary Database** | PostgreSQL 16 (Alpine) with repeatable Prisma migrations |
| **Broker & State** | Redis 7 (Alpine) with Append-Only File (`AOF`) persistence |
| **Search Engine** | Elasticsearch 8.17 (single-node development container) |
| **Testing** | Vitest 3, Supertest 7 (154 automated unit & integration tests) |

---

## 4. Architecture Diagram

```mermaid
flowchart TD
    subgraph Client["Client Tier"]
        UI["React 18 + Vite Frontend\n(apps/web: port 5173)\nCampaign Composer & Live Dashboard"]
    end

    subgraph API["API Server Tier (apps/api: port 5000)"]
        AUTH["Auth Router\n(/auth/google, /auth/slack)"]
        EMAIL["Email Router\n(/api/emails, /api/schedule, /api/cancel)"]
        SEARCH["Search Router\n(/api/search/emails, /api/search/rebuild)"]
        DASH["Queue Dashboard\n(/admin/queues - Bull Board)"]
        GUARD["Auth & Token Guard\n(Session Cookie / X-Admin-Token)"]
    end

    subgraph DataTier["Data & Queue Tier"]
        PG[("PostgreSQL 16\nAuthoritative Source of Truth\nUsers, Emails, OutboxEvents")]
        REDIS[("Redis 7 (AOF)\nBullMQ 'email-jobs' Queue\nLua Rate Limiters & Deduplication")]
        ES[("Elasticsearch 8.x\n'reachinbox_emails' Index\nRebuildable Search Replica")]
    end

    subgraph WorkerTier["Worker Tier (apps/worker)"]
        WORKER["BullMQ Worker (apps/worker)\nConcurrency: 5-10 lanes"]
        CLAIM["Atomic Lease Claim\n(120s processing lease)"]
        LIMITER["Distributed Rate Limiter\n(Hourly cap + send pacing)"]
        TRANSPORT["SMTP Mailer\n(Ethereal test transport)"]
        AMBIGUOUS["Ambiguous Result Guard\n(Quarantine on uncertainty)"]
    end

    subgraph External["External Integrations"]
        SLACK["Slack Webhook / API\n(Rate limit alerts)"]
        ETHEREAL["Ethereal SMTP / Web Preview\n(ethereal.email)"]
    end

    UI -->|HTTP + Session Cookie| GUARD
    GUARD --> AUTH
    GUARD --> EMAIL
    GUARD --> SEARCH
    GUARD --> DASH

    EMAIL -->|Prisma Transaction| PG
    EMAIL -->|Outbox Enqueue| REDIS
    SEARCH -->|Full-Text Query| ES
    SEARCH -.->|Fallback on ES Down| PG

    REDIS -->|Job Dispatch| WORKER
    WORKER --> CLAIM
    CLAIM -->|Validate & Lock| PG
    CLAIM --> LIMITER
    LIMITER -->|Check Lua Script| REDIS
    LIMITER -->|If Denied: DelayedError| REDIS
    LIMITER -->|If Permitted| TRANSPORT
    TRANSPORT -->|SMTP Send| ETHEREAL
    TRANSPORT -->|Alert on Cap| SLACK
    TRANSPORT -->|Mark SENT / FAILED| PG
    TRANSPORT -->|Async Re-index| ES
    TRANSPORT -.->|Stale Worker Detected| AMBIGUOUS
```

---

## 5. Monorepo Directory Structure

```text
reachinbox-email-scheduler/
├── apps/
│   ├── api/                           # Express REST API & Authentication Server
│   │   ├── prisma/
│   │   │   ├── migrations/            # Repeatable SQL schema migrations
│   │   │   └── schema.prisma          # PostgreSQL relational schema
│   │   ├── src/
│   │   │   ├── __tests__/             # 8 test suites (82 passing tests)
│   │   │   ├── controllers/           # HTTP route handlers
│   │   │   ├── db/                    # Prisma client singleton
│   │   │   ├── middleware/            # Auth guard, Zod validation, error handler
│   │   │   ├── queue/                 # BullMQ queue client & Bull Board dashboard
│   │   │   ├── redis/                 # ioredis client
│   │   │   ├── routes/                # Auth, email, scheduler, search, slack routes
│   │   │   ├── services/              # Email, scheduler, outbox, ES, Slack services
│   │   │   ├── validations/           # Zod input schemas
│   │   │   ├── app.ts                 # Express factory & router mounts
│   │   │   ├── config.ts              # Validated environment configuration
│   │   │   └── index.ts               # Server entrypoint & graceful shutdown
│   │   └── package.json
│   ├── web/                           # React 18 + Vite Frontend Application
│   │   ├── src/
│   │   │   ├── components/            # Campaign composer, tables, Slack settings
│   │   │   ├── api.ts                 # Typed REST client
│   │   │   ├── App.tsx                # Main single-page application & routing
│   │   │   ├── index.css              # Glassmorphic CSS design system
│   │   │   └── main.tsx               # DOM root
│   │   └── package.json
│   └── worker/                        # Background BullMQ Worker Process
│       ├── src/
│       │   ├── __tests__/             # 6 test suites (72 passing tests)
│       │   ├── config.ts              # Worker environment parsing
│       │   ├── es-indexer.ts          # Async Elasticsearch status indexer
│       │   ├── mailer.ts              # Nodemailer Ethereal SMTP transporter
│       │   ├── processor.ts           # Atomic claim, lease, quarantine, retry logic
│       │   ├── rate-limiter.ts        # Redis Lua sliding window rate limiter
│       │   ├── slack-alert.ts         # Worker rate limit Slack notifier
│       │   └── index.ts               # Worker entrypoint & signal handlers
│       └── package.json
├── packages/
│   └── shared/                        # Shared TypeScript DTOs & Contracts
│       ├── src/index.ts               # EmailDto, CreateEmailInput, LeadDto, etc.
│       └── package.json
├── docs/                              # Project Documentation
│   ├── DECISIONS_AND_LIMITATIONS.md   # Architectural tradeoffs & reliability limits
│   ├── DEMO_SCRIPT.md                 # 5-minute timed video recording script
│   ├── LOCAL_SETUP.md                 # Detailed step-by-step local setup guide
│   ├── PROJECT_STATUS.md              # Milestone status matrix & architecture
│   ├── REQUIREMENT_TRACEABILITY.md    # Requirement to code traceability matrix
│   └── TESTING.md                     # Test guide, 1,000-job load test, failure matrix
├── .env.example                       # Documented environment variable template
├── .gitignore                         # Excludes node_modules, dist, .env, logs
├── docker-compose.yml                 # PostgreSQL 16, Redis 7, Elasticsearch 8.17
├── package.json                       # Monorepo root workspace configuration
├── tsconfig.base.json                 # Strict TypeScript configuration
└── README.md                          # Master documentation
```

---

## 6. Prerequisites

- **Node.js**: `v20.x` or `v24.x` (LTS recommended)
- **npm**: `v10.x` or higher
- **Docker & Docker Compose**: For local PostgreSQL, Redis, and Elasticsearch containers
- **Git**

---

## 7. Local Setup Instructions

### 1. Clone & Install Dependencies
```bash
git clone <repo-url>
cd Email-jobscheduler
npm install
```

### 2. Start Infrastructure Containers
```bash
docker compose up -d
```
Starts:
- **PostgreSQL 16** (`localhost:5432`)
- **Redis 7** with AOF (`localhost:6379`)
- **Elasticsearch 8.17** (`localhost:9200`)

Check container health:
```bash
docker compose ps
```

### 3. Configure Environment Variables
```bash
cp .env.example .env
```
Default values in `.env.example` are pre-configured to work immediately for local development.

### 4. Run Database Migrations
```bash
npm run prisma:migrate --workspace=apps/api
```

### 5. Build Workspace Packages
```bash
npm run build
```

### 6. Run the Application
You can run all three services concurrently:
```bash
npm run dev:all
```
Or start them individually in separate terminals:
```bash
# Terminal 1: API (port 5000)
npm run dev:api

# Terminal 2: Worker
npm run dev:worker

# Terminal 3: Web Frontend (port 5173)
npm run dev:web
```

---

## 8. Service Endpoints & Access

| Service | Local URL | Auth / Protection |
|---|---|---|
| **Web Frontend** | `http://localhost:5173` | Google OAuth / Dev User fallback |
| **REST API** | `http://localhost:5000` | Session Cookie (`reachinbox.sid`) |
| **API Health Probes** | `http://localhost:5000/health`, `/ready` | Public |
| **Queue Dashboard** | `http://localhost:5000/admin/queues` | Localhost only (dev); `X-Admin-Token` (prod) |
| **Elasticsearch Status**| `http://localhost:5000/api/search/status`| Public probe |
| **Index Rebuild** | `http://localhost:5000/api/search/rebuild`| Localhost only (dev); `X-Admin-Token` (prod) |

---

## 9. Environment Variable Reference

| Variable | Default Value | Description |
|---|---|---|
| `PORT` | `5000` | Port for the Express API |
| `NODE_ENV` | `development` | Runtime environment (`development`, `test`, `production`) |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin and redirect target |
| `DATABASE_URL` | `postgresql://reachinbox:reachinbox_secret@localhost:5432/reachinbox_db` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis broker connection string |
| `WORKER_CONCURRENCY` | `5` | Concurrent jobs processed per worker process |
| `RATE_LIMIT_MAX_PER_HOUR` | `100` | Maximum email sends allowed per hour (0 = unlimited) |
| `RATE_LIMIT_INTERVAL_MS` | `1000` | Minimum delay in milliseconds between consecutive sends |
| `RATE_LIMIT_SCOPE` | `global` | Scope of rate limiter: `global` or `per-sender` |
| `SESSION_SECRET` | `dev-session-secret...` | Secret key for signing session cookies |
| `GOOGLE_CLIENT_ID` | *(optional in dev)* | Google Cloud OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | *(optional in dev)* | Google Cloud OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:5000/auth/google/callback` | OAuth redirect URI |
| `SLACK_CLIENT_ID` | *(optional in dev)* | Slack App Client ID |
| `SLACK_CLIENT_SECRET` | *(optional in dev)* | Slack App Client Secret |
| `SLACK_REDIRECT_URI` | `http://localhost:5000/auth/slack/callback` | Slack OAuth redirect URI |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Elasticsearch cluster endpoint |
| `ELASTICSEARCH_INDEX` | `reachinbox_emails` | Name of the primary search index |
| `ADMIN_TOKEN` | *(unset in dev)* | Secret required for admin endpoints in production |
| `EMAIL_QUEUE_NAME` | `email-jobs` | BullMQ queue identifier |

---

## 10. Automated Testing

The repository features comprehensive automated test coverage with **154 passing tests** across 14 test suites.

```bash
# Run all workspace test suites
npm test

# Run API workspace tests (82 tests)
npm run test:api

# Run Worker workspace tests (72 tests)
npm run test:worker
```

### 1,000 Synthetic Jobs Load Test
Execute the dedicated high-concurrency load test:
```bash
npm test --workspace=@reachinbox/worker -t "1,000 Synthetic Jobs"
```
Measures throughput, concurrency safety, observable failure handling on 550 recipient bounces, and verified mid-stream worker crash recovery with **zero duplicates**.

---

## 11. Example API Usage

### Create an Email Draft (with Idempotency-Key)
```bash
curl -X POST http://localhost:5000/api/emails \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: draft-uuid-001" \
  -d '{
    "recipient": "lead@company.test",
    "subject": "Acme Alpha Invitation",
    "body": "Welcome aboard! Here is your private activation code."
  }'
```

### Schedule Email Delivery
```bash
curl -X POST http://localhost:5000/api/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "emailId": "<email-id>",
    "scheduledTime": "2026-10-18T10:00:00.000Z"
  }'
```

### Full-Text Search Across Emails
```bash
curl "http://localhost:5000/api/search/emails?q=Acme&status=SENT&page=1&limit=20"
```

### Cancel a Scheduled Email
```bash
curl -X POST http://localhost:5000/api/cancel \
  -H "Content-Type: application/json" \
  -d '{ "emailId": "<email-id>" }'
```

---

## 12. Troubleshooting Guide

| Issue | Cause | Solution |
|---|---|---|
| **Elasticsearch container fails to start** | Insufficient Docker memory allocation | Increase Docker Desktop memory to ≥ 2 GB. |
| **Search returns PostgreSQL fallback** | Elasticsearch container is initializing or down | Normal behavior. Search transparently queries PostgreSQL with identical filters. |
| **Dashboard returns 403 Forbidden** | Accessing `/admin/queues` from a non-localhost IP in development | Access via `http://localhost:5000` or `http://127.0.0.1:5000`. In production, supply `X-Admin-Token`. |
| **Worker logs `Rate limited: Deferring job`** | Pacing interval or hourly quota reached | Expected behavior. Worker uses BullMQ `DelayedError` to sleep without failing the job. |
| **Prisma Client missing fields** | Schema changed without re-generating client | Run `npm run prisma:generate --workspace=@reachinbox/api`. |

---

## 13. Architecture Decisions & Reliability Guarantees

### What Is Guaranteed
1. **At-Least-Once Delivery**: No scheduled job is permanently dropped due to network partitions or process restarts.
2. **Transactional State Transitions**: Email states (`DRAFT` → `SCHEDULED` → `PROCESSING` → `SENT` / `FAILED`) are conditional and guarded by processing ownership and lease expiration.
3. **Multi-User Data Isolation**: Every read, write, and search operation is scoped to `userId` on the server.
4. **Idempotency Protection**: Duplicate requests with matching `Idempotency-Key` return cached results with `Idempotent-Replay: true`.

### What Is Best-Effort
1. **Exactly-Once Delivery**: SMTP protocol specifications do not support distributed transactional commit protocols. In the rare event of a TCP disconnection after SMTP acceptance but before local database persistence, our localized retry and quarantine logic prevents blind resends.
2. **Elasticsearch Indexing**: Elasticsearch is treated as a read-side search index. If indexing fails, PostgreSQL remains authoritative, and search queries gracefully fall back to database text filters.

---

## 14. License

UNLICENSED — Built for ReachInbox Technical Assessment.

## Run the complete stack with Docker Compose (Windows)

Prerequisites: Docker Desktop with the **Linux** container engine running, WSL 2 enabled, and Docker Desktop WSL integration enabled for your Ubuntu distribution. Open PowerShell in the repository folder.

1. Copy the example environment file and keep real secrets out of Git:

   ```powershell
   Copy-Item .env.example .env
   ```

   The Compose development defaults provide PostgreSQL, Redis, Elasticsearch, and a development session secret. Set OAuth values only if you plan to use those integrations. Leave `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` empty for local email tests; the worker uses Ethereal, a test mailbox that does not deliver to real recipients. Its preview links are logged without SMTP passwords. The web app is at `http://localhost:5173`, and the API is at `http://localhost:5000`.

2. Validate and build/start all services:

   ```powershell
   docker compose config --quiet
   docker compose up --build -d
   docker compose ps
   ```

   The API applies checked-in Prisma migrations before starting. The worker waits for the API health check, and one worker container is started by default so each queue job has one intended consumer process.

3. Open `http://localhost:5173`. Check API health at `http://localhost:5000/health` and API readiness at `http://localhost:5000/ready`.

Useful commands:

```powershell
docker compose logs -f
docker compose logs --tail=100 api worker
docker compose restart
docker compose down
```

`docker compose down` removes containers and the Compose network but preserves the named PostgreSQL, Redis, and Elasticsearch volumes. Do not use `docker compose down --volumes` unless you intend to erase that persistent data. Back up important data separately.

The `.env` file is ignored by Git. Do not put production credentials in `.env.example`. The supplied Compose configuration is for local development; it uses an unauthenticated Elasticsearch instance and a development session secret. Configure production secrets, SMTP, OAuth, and secured infrastructure before any production deployment.

### Docker Desktop troubleshooting

If `docker compose` reports that it cannot connect to `dockerDesktopLinuxEngine`, Docker Desktop's Linux engine is unavailable to the CLI. Start Docker Desktop and wait for its engine status to become ready, then run `docker info` and `docker compose version` again. If WSL reports `E_ACCESSDENIED`, retry `wsl --status` and `wsl -l -v` from a normal Windows terminal; if access remains denied, review Docker Desktop's WSL Integration settings for the installed Ubuntu distribution. Do not reset Docker Desktop or delete volumes to resolve a named-pipe connection error.
