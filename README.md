# ReachInbox Email Job Scheduler

A production-style email scheduler and dashboard. The API accepts email send requests, stores them in PostgreSQL and schedules them as **BullMQ delayed jobs in Redis** (no cron of any kind). A separate worker sends them through **Ethereal Email** (fake SMTP), with per-sender hourly limits, a minimum delay between sends, configurable concurrency, Slack alerts when a limit is hit, Elasticsearch search and a live BullMQ dashboard. Scheduled emails survive restarts and are never sent twice.

| Part | Stack |
|---|---|
| API | TypeScript, Express 4, Prisma 6, BullMQ 5 + ioredis, express-session, zod |
| Worker | TypeScript, BullMQ worker, Nodemailer (Ethereal), Redis Lua rate limiter |
| Database | PostgreSQL 16 (Prisma migrations) |
| Queue | Redis 7 with AOF persistence |
| Search | Elasticsearch 8 |
| Frontend | React 18 + TypeScript, Vite 6, hand-written CSS |
| Auth | Google OAuth 2.0 (sessions in HTTP-only cookies) |
| Alerts | Slack OAuth v2 (bot token or incoming webhook) |

Monorepo layout: `apps/api` (Express API), `apps/worker` (BullMQ worker), `apps/web` (React dashboard), `packages/shared` (shared TypeScript types), `docker-compose.yml` (Postgres, Redis, Elasticsearch, and optional API/worker/web containers).

---

## 1. Quick start

Prerequisites: Node.js 20+ and npm 10+, Docker Desktop (for Postgres, Redis and Elasticsearch).

```bash
git clone https://github.com/karan1207-cse/Email-jobScheduler.git
cd Email-jobScheduler
npm install
cp .env.example .env            # then fill in the values described in section 4
docker compose up -d postgres redis elasticsearch
npm run prisma:migrate --workspace=@reachinbox/api
npm run build:shared
```

Then start the three processes, each in its own terminal (sections 2 and 3):

```bash
npm run dev:api       # Express API on http://localhost:5000
npm run dev:worker    # BullMQ worker
npm run dev:web       # React dashboard on http://localhost:5173
```

Or all three in one terminal: `npm run dev:all`.

| What | URL |
|---|---|
| Dashboard | http://localhost:5173 |
| API | http://localhost:5000 |
| Health (DB + Redis) | http://localhost:5000/health |
| BullMQ dashboard | http://localhost:5000/admin/queues |
| Search status | http://localhost:5000/api/search/status |

---

## 2. How to run the backend (Express, Redis, DB, BullMQ worker)

The backend consists of three containerized backing services plus two Node.js processes:

| Piece | How it runs | Notes |
|---|---|---|
| PostgreSQL 16 | `docker compose up -d postgres` | Port 5432, data in volume `reachinbox_postgres_data` |
| Redis 7 | `docker compose up -d redis` | Port 6379, `--appendonly yes` so delayed jobs survive a Redis restart |
| Elasticsearch 8 | `docker compose up -d elasticsearch` | Port 9200, single node. Optional: search seamlessly falls back to PostgreSQL when unavailable |
| Express API | `npm run dev:api` | Port 5000. Run `npm run prisma:migrate --workspace=@reachinbox/api` before starting |
| BullMQ Worker | `npm run dev:worker` | Background job processor with rate limiter, pacing, and SMTP delivery |

### Step-by-step backend startup:
1. **Start backing services:**
   ```bash
   docker compose up -d postgres redis elasticsearch
   ```
2. **Run database migrations:**
   ```bash
   npm run prisma:migrate --workspace=@reachinbox/api
   ```
3. **Start the API & Worker:**
   ```bash
   npm run dev:api       # In Terminal 1 (API on http://localhost:5000)
   npm run dev:worker    # In Terminal 2 (Worker with BullMQ concurrency & pacing)
   ```

Production build: `npm run build`, then `npm run start --workspace=@reachinbox/api` and `npm run start --workspace=@reachinbox/worker`.

Everything in Docker: `docker compose up -d --build` builds and starts Postgres, Redis, Elasticsearch, API, worker, and web together.

---

## 3. How to run the frontend

```bash
npm run dev:web        # Launches React + Vite dashboard on http://localhost:5173
npm run build:web      # Production build compiled into apps/web/dist
```

The dashboard calls the API at `VITE_API_URL` (default `http://localhost:5000`) with cookies, so the API's `FRONTEND_URL` must match the address you open the dashboard on (CORS and the OAuth redirect use it).

---

## 4. How to set up Ethereal Email and env variables

### Ethereal (fake SMTP)

Nothing to set up for a first run: leave `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` empty. On the first send the worker creates an Ethereal test inbox with `nodemailer.createTestAccount()`, stores it in Redis (`reachinbox:ethereal:test-account`) and reuses it after restarts and across worker instances. No email ever leaves Ethereal.

To see a sent email, open it in the dashboard and click **Open sent message in Ethereal**. Every sent email stores its SMTP Message-ID and Ethereal preview link in the database. The sender's name and address are shown as From.

For a fixed inbox you can log into, create an account at https://ethereal.email and set:

```env
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=<your ethereal user>
SMTP_PASS=<your ethereal password>
```

The worker refuses to start with only some of the three, and in production it refuses the Ethereal fallback entirely.

### Environment variables setup

All values live in `.env` at the repository root (git-ignored). `.env.example` lists every variable with placeholders.

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `NODE_ENV` | `development` | all | `production` enables secure cookies and stricter checks |
| `PORT` | `5000` | API | API port |
| `HOST` | all interfaces | API | Optional bind address, e.g. `::1` |
| `FRONTEND_URL` | `http://localhost:5173` | API | CORS origin and where OAuth sends the browser back |
| `DATABASE_URL` | local Postgres | API, worker | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | API, worker | Redis for BullMQ, rate limits and the Ethereal account |
| `EMAIL_QUEUE_NAME` | `email-jobs` | API, worker | BullMQ queue name |
| `WORKER_CONCURRENCY` | `5` | worker | Jobs processed in parallel per worker process |
| `RATE_LIMIT_MAX_PER_HOUR` | `100` | worker | Emails per clock hour (per sender with `per-sender`); `0` = unlimited |
| `RATE_LIMIT_SCOPE` | `per-sender` | worker | `per-sender` or `global` |
| `RATE_LIMIT_INTERVAL_MS` | `1000` | worker | Minimum delay between two sends; `0` = none |
| `RATE_LIMIT_KEY_PREFIX` | `rl:reachinbox` | worker | Redis key prefix for limiter counters |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | empty / `587` | worker | Real SMTP relay; all empty = Ethereal |
| `SMTP_FROM` | `ReachInbox Scheduler <scheduler@reachinbox.local>` | worker | From address on a real relay |
| `SESSION_SECRET` | dev value | API | Signs session cookies; required in production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty | API | Google OAuth client (Google Cloud Console → Credentials) |
| `GOOGLE_REDIRECT_URI` | `http://localhost:5000/auth/google/callback` | API | Must be listed exactly in the Google OAuth client |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | empty | API | Slack app credentials (api.slack.com/apps) |
| `SLACK_REDIRECT_URI` | `http://localhost:5000/auth/slack/callback` | API | Must be listed in the Slack app's redirect URLs (Slack needs https outside localhost) |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | API, worker | Search cluster |
| `ELASTICSEARCH_INDEX` | `reachinbox_emails` | API, worker | Index name |
| `ADMIN_TOKEN` | empty | API | Protects `/admin/queues` and `/api/search/rebuild`; required for the dashboard in production |
| `ADMIN_EMAIL` | empty | API | In development, this signed-in Google account may open the queue dashboard remotely |
| `DASHBOARD_ALLOWED_IPS` | `10.0.2.2` | API | Extra client IPs allowed to open the queue dashboard in development (default = VirtualBox NAT host) |
| `ALLOW_DEV_LOGIN` | off | API | `true` adds a localhost-only sign-in as a built-in dev user, for machines without Google keys. Never enable on a public host |
| `VITE_API_URL` | `http://localhost:5000` | web | API address used by the dashboard |

---

## 5. Architecture overview

```
 Browser (React dashboard)
   │  REST + session cookie
   ▼
 Express API ──────────────► PostgreSQL  (emails, users, outbox_events, slack_integrations)
   │  queue.add(delay, jobId=email-<id>)        ▲
   ▼                                            │ claim / status updates
 Redis ── BullMQ "email-jobs" (delayed → waiting → active) ──► Worker(s)
   ▲                                                             │
   │ rate-limit counters, pacing lock, Ethereal account          ├─► Ethereal SMTP
   └─────────────────────────────────────────────────────────────┤
                                                                 ├─► Slack (on hourly limit)
 Elasticsearch ◄── index on create / schedule / send ────────────┘
 Bull Board (/admin/queues) reads the same queue live
```

### How scheduling works

1. `POST /api/emails` creates a `DRAFT` row (an optional `Idempotency-Key` header makes retries return the same email).
2. `POST /api/emails/:id/schedule` with a future `scheduledTime` runs one database transaction: the email becomes `SCHEDULED` and an `EMAIL_SCHEDULED` outbox event is written. The API then adds a BullMQ job with `delay = scheduledTime − now` and the fixed id `email-<emailId>`, and marks the outbox event processed.
3. BullMQ keeps the job in Redis's delayed set. At the due time it becomes available and a worker picks it up. No polling and no cron: BullMQ's own delayed-job mechanism releases it.
4. The worker atomically claims the email (`UPDATE … WHERE status = 'SCHEDULED'` → `PROCESSING`). Only one worker can win, so a duplicate job can never cause a second send.
5. It checks the rate limiter (section 5.3), sends through SMTP, then marks the email `SENT` and saves the Message-ID and Ethereal preview link. It also writes an `EMAIL_SENT` event and re-indexes the email in Elasticsearch.
6. SMTP errors are retried by BullMQ (3 attempts, exponential backoff from 5 s). After the last attempt the email becomes `FAILED` with the error saved.
7. `POST /api/emails/:id/cancel` removes the job and marks the email `CANCELLED`. The worker re-checks the status just before sending, so a cancel that races the worker still wins.

### How persistence on restart is handled

- **Jobs live in Redis, not in process memory.** Restarting the API or the worker loses nothing; delayed jobs fire at their original time. Redis runs with AOF (`appendonly yes`), so even a Redis restart keeps them.
- **Deterministic job ids** (`email-<emailId>`): adding the same email again is a no-op, so retries and recovery cannot create duplicates.
- **Transactional outbox:** if the API crashes between the database commit and `queue.add`, the `PENDING` outbox event is re-enqueued on the next start.
- **Start-up reconciliation:** on every start the API checks every `SCHEDULED` email. It re-enqueues those whose job is missing (for example Redis data was lost) and retries those whose job had failed before the worker could claim them (for example the database was down). An overdue email runs immediately; a future one keeps its time.
- **No duplicate sends after a crash:** an email found in `PROCESSING` after a crash or retry is treated as possibly delivered. It is marked `FAILED` with a clear note instead of being sent again. Post-send database writes are retried locally so a short database blip does not cause a resend.
- **Stalled jobs:** BullMQ re-delivers jobs held by a worker that died (`stalledInterval` 30 s); the database claim above keeps that safe.

### How rate limiting & concurrency are implemented

**Chosen values** (all configurable in `.env`):

- At most **100 emails per sender per clock hour** (`RATE_LIMIT_MAX_PER_HOUR=100`, `RATE_LIMIT_SCOPE=per-sender`).
- A minimum of **1 second between sends** (`RATE_LIMIT_INTERVAL_MS=1000`).
- **5 jobs in parallel** per worker process (`WORKER_CONCURRENCY=5`).

**Enforcement.** Before talking to SMTP, every job runs one Redis Lua script (`apps/worker/src/rate-limiter.ts`). Lua scripts run atomically in Redis, and every worker on every machine uses the same keys, so the limits hold however many workers run. No in-memory counters are used.

1. **Pacing:** if the key `rl:reachinbox:{user:<id>}:pace` still has a TTL, the job waits that many milliseconds. No quota is used.
2. **Hourly quota:** the script `INCR`s `rl:reachinbox:{user:<id>}:hour:<window>`, where `<window>` is the current clock hour taken from Redis server time, so worker clocks don't matter. If that goes over the limit, the increment is undone and the script returns the start of the next hour.
3. On success it sets the pacing key with `PX <interval>`.

**When the hourly limit is reached:**

- The job is never dropped or failed. The worker puts the email back to `SCHEDULED` and moves the job to `delayed` with the start of the next hour as its run time. It throws BullMQ's `DelayedError`, which does not use up a retry.
- All deferred jobs get the same run time, and BullMQ releases jobs with equal run times in the order they were deferred, so the original order is kept.
- At that moment the sender's Slack channel gets an alert, once per sender per hour. If Slack is not connected nothing happens and nothing fails. Connections are read from the database on every hit, so connecting later works without a redeploy.

**Concurrency safety.**

- `WORKER_CONCURRENCY` jobs run in parallel per process, and you can run several worker processes.
- Parallel jobs are safe because of the atomic database claim, BullMQ's per-job lock, conditional status updates (`WHERE status = 'PROCESSING'`) and the shared Redis limiter.

**1000+ emails due at the same moment.**

- BullMQ moves them all to `waiting`, and each worker takes `WORKER_CONCURRENCY` at a time.
- Pacing lets one send through per interval per sender; the others wait out the remaining interval and try again.
- Once a sender's hourly quota is used, the rest roll over to the next hour, then the next, until all are sent. Nothing is lost or sent twice.
- The compose screen also spreads a lead list over time: send times are `start + i × max(delay, 3600 / hourly limit)`, so a big list doesn't pile up at one moment.

---

## 6. List of features implemented

### Backend: scheduler, persistence, rate limiting, concurrency

| Area | What is implemented | Where |
|---|---|---|
| Scheduler | REST API to create, edit (drafts), schedule and cancel emails; BullMQ delayed jobs with deterministic ids; no cron | `apps/api/src/services/scheduler.service.ts`, `apps/api/src/queue` |
| Persistence | PostgreSQL via Prisma; transactional outbox; start-up reconciliation; Redis AOF; crash-safe send state machine (`DRAFT → SCHEDULED → PROCESSING → SENT / FAILED / CANCELLED`) | `apps/api/prisma`, `apps/api/src/index.ts`, `apps/worker/src/processor.ts` |
| Idempotency | `Idempotency-Key` header with payload fingerprint (replay returns the same email, a different payload returns 409); one job per email; atomic claim | `apps/api/src/services/email.service.ts` |
| Rate limiting | Per-sender (or global) hourly quota keyed by clock hour and sender, minimum delay between sends, both in one atomic Redis Lua script; rollover to the next hour in order | `apps/worker/src/rate-limiter.ts` |
| Concurrency | Configurable `WORKER_CONCURRENCY`; safe across processes and machines | `apps/worker/src/index.ts` |
| Delivery | Ethereal SMTP with a shared cached inbox, per-sender From, preview link and Message-ID saved; retries with backoff; real SMTP relay supported | `apps/worker/src/mailer.ts` |
| Multiple senders | Every Google user is a sender with their own quota and From identity | `apps/worker/src/processor.ts` |
| Slack alerts | Slack OAuth v2 connect, disconnect, test message; alert on hourly limit hit | `apps/api/src/routes/slack.routes.ts`, `apps/worker/src/slack-alert.ts` |
| Search | Elasticsearch index updated on create, schedule and send; full-text search scoped to the signed-in user; PostgreSQL fallback | `apps/api/src/services/elasticsearch.service.ts`, `apps/api/src/routes/search.routes.ts` |
| Queue dashboard | Bull Board at `/admin/queues` (localhost, allowed IPs, admin email or admin token) | `apps/api/src/queue/dashboard.ts` |
| Auth and security | Google OAuth with CSRF state; HTTP-only SameSite cookies; per-user data isolation; zod validation; security headers; HTML escaping of email content | `apps/api/src/routes/auth.routes.ts`, `apps/api/src/middleware` |
| Health | `/health` and `/ready` check PostgreSQL and Redis | `apps/api/src/routes/health.ts` |

### Frontend: login, dashboard, compose, tables, etc.

| Screen | What it does | Where |
|---|---|---|
| Login | "Sign in with Google" with secure OAuth redirect and profile avatar display | `apps/web/src/components/LoginScreen.tsx` |
| Main Dashboard | Top header (user info, avatar, logout) + collapsible sidebar with folder counts | `apps/web/src/components/Sidebar.tsx` |
| Tables (Scheduled / Sent / All) | Email tables per folder with status badges, recipient, scheduled/sent time; status filter; search box (Elasticsearch); refresh; empty states | `apps/web/src/components/EmailListView.tsx` |
| Compose Modal | Recipient or CSV/TXT lead list upload, subject, rich-text body, attachments, send now or schedule picker, delay between emails and hourly limit used to spread a campaign | `apps/web/src/components/ComposeView.tsx` |
| Email Detail View | Full email preview with status, attachments, Ethereal preview link, Message-ID and last error diagnostics | `apps/web/src/components/EmailDetailView.tsx` |
| Slack Settings | Connect Slack (OAuth), connection status, test message notification, disconnect | `apps/web/src/components/SlackSettings.tsx` |
| Queue Dashboard Link | Direct navigation to live BullMQ Bull Board from the sidebar | `apps/web/src/components/Sidebar.tsx` |

---

## 7. Automated Tests & Verification

```bash
npm test                 # Complete test run across API and Worker (154/154 passing)
npm run test:api         # 82 API tests (Auth, Routing, Slack, Search, Recovery)
npm run test:worker      # 72 Worker tests (Rate Limiter, Concurrency, SMTP, Outbox)
```

154 automated tests (API 82, worker 72) with 100% pass rate. Covers:
- Atomic concurrency and claim lease verification under simulated race conditions
- Pacing delay & sliding window rate-limit enforcement
- Delayed-job persistence & recovery across simulated worker and API outages
- Elasticsearch full-text search and seamless PostgreSQL fallback
- Google OAuth tenant isolation and cross-user data boundaries
- Slack rate-limit notification deduplication and webhook delivery

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Worker fails with `@prisma/client did not initialize yet` | `npm run prisma:generate --workspace=@reachinbox/worker` (runs automatically before `dev` and `build`) |
| `/admin/queues` returns 403 | You are not on localhost (for example a port forward into a VM). Add the IP to `DASHBOARD_ALLOWED_IPS`, or set `ADMIN_TOKEN` and open `/admin/queues?token=<ADMIN_TOKEN>` once |
| Google sign-in error `redirect_uri_mismatch` | `GOOGLE_REDIRECT_URI` must exactly match an authorized redirect URI in the Google OAuth client |
| Logged-in requests return 401 from the dashboard | `FRONTEND_URL` and `VITE_API_URL` must match the addresses in the browser bar |
| Search says `postgres_fallback` | Elasticsearch is still starting or down; results come from PostgreSQL meanwhile |
| Worker logs `Rate limited … Deferring` | Expected: pacing or the hourly quota; the job waits without failing |
| Docker CLI hangs on Windows | Restart Docker Desktop and run `wsl --shutdown` |
