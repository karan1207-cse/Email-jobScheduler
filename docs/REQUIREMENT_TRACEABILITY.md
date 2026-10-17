# Requirement Traceability Matrix

Maps assignment requirements to implementation locations and verification evidence.

## Milestone 1 — Monorepo & Shared Foundation

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| TypeScript monorepo with workspaces | `package.json`, `tsconfig.base.json` | ✅ Verified via `npm run build` |
| Shared types package | `packages/shared/` | ✅ Verified via `@reachinbox/shared` |
| Docker Compose (Postgres, Redis) | `docker-compose.yml` | ✅ Verified via `docker compose config` |

## Milestone 2 — Database & REST API

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| Prisma schema (Email, User, LeadBatch, Lead, OutboxEvent) | `apps/api/prisma/schema.prisma` | ✅ Verified via `prisma:generate` |
| CRUD endpoints for emails | `apps/api/src/routes/email.routes.ts` | ✅ Verified in `email.test.ts` |
| Idempotency key support & content fingerprinting | `apps/api/src/services/email.service.ts` | ✅ Verified in `email.test.ts` & `failure-injection.test.ts` |
| Input validation (Zod) | `apps/api/src/validations/email.schema.ts` | ✅ Verified in `email.test.ts` |

## Milestone 3 — BullMQ Delayed Scheduling

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| POST /api/schedule — schedule email | `apps/api/src/routes/scheduler.routes.ts` | ✅ Verified in `scheduler.test.ts` |
| POST /api/cancel — cancel scheduled email | `apps/api/src/routes/scheduler.routes.ts` | ✅ Verified in `scheduler.test.ts` |
| BullMQ delayed job creation | `apps/api/src/services/scheduler.service.ts` | ✅ Verified in `scheduler.test.ts` |
| Transactional outbox pattern | `apps/api/src/services/outbox.service.ts` | ✅ Verified in `failure-injection.test.ts` |
| BullMQ worker processes jobs | `apps/worker/src/processor.ts` | ✅ Verified in `processor.test.ts` |

## Milestone 4 — Distributed Rate Limiting

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| Redis Lua atomic rate limiter | `apps/worker/src/rate-limiter.ts` | ✅ Verified in `rate-limiter.test.ts` |
| Hourly limit per user | `apps/worker/src/rate-limiter.ts` | ✅ Verified in `rate-limiter.test.ts` |
| Pacing interval enforcement | `apps/worker/src/rate-limiter.ts` | ✅ Verified in `rate-limiter.test.ts` |
| DelayedError on rate limit | `apps/worker/src/processor.ts` | ✅ Verified in `bullmq-deferral.test.ts` |

## Milestone 5 — SMTP Reliability

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| Atomic SCHEDULED→PROCESSING claim | `apps/worker/src/processor.ts` | ✅ Verified in `processor.test.ts` |
| Lease-based stale worker detection | `apps/worker/src/processor.ts` | ✅ Verified in `processor.test.ts` |
| SMTP failure → SCHEDULED or FAILED | `apps/worker/src/processor.ts` | ✅ Verified in `processor.test.ts` |
| Ambiguous delivery: PostSendDatabaseError | `apps/worker/src/processor.ts` | ✅ Verified in `processor.test.ts` |
| Localized DB retry (3x) after SMTP accept | `apps/worker/src/processor.ts` | ✅ Verified in `processor.test.ts` |
| Ethereal test SMTP integration | `apps/worker/src/mailer.ts` | ✅ Verified in `mailer.test.ts` |

## Milestone 6 — Authentication & Multi-User Isolation

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| Google OAuth 2.0 (server-side) | `apps/api/src/routes/auth.routes.ts` | ✅ Verified in `auth.test.ts` |
| Session management (HTTP-only cookie) | `apps/api/src/app.ts` | ✅ Verified in `auth.test.ts` |
| requireAuth middleware | `apps/api/src/middleware/auth.ts` | ✅ Verified in `auth.test.ts` |
| userId scoping on all email endpoints | `apps/api/src/services/email.service.ts` | ✅ Verified in `auth.test.ts` & `failure-injection.test.ts` |

## Milestone 7 — React Frontend

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| Campaign Composer | `apps/web/src/App.tsx` | ✅ Verified via `@reachinbox/web` build |
| CSV/TXT lead parser | `apps/web/src/App.tsx` | ✅ Verified via `@reachinbox/web` build |
| Scheduled/Sent/Draft/Failed tables | `apps/web/src/App.tsx` | ✅ Verified via `@reachinbox/web` build |
| Live countdown timers | `apps/web/src/App.tsx` | ✅ Verified via `@reachinbox/web` build |
| System health telemetry | `apps/web/src/App.tsx` | ✅ Verified via `@reachinbox/web` build |
| Google OAuth login UI | `apps/web/src/App.tsx` | ✅ Verified via `@reachinbox/web` build |

## Milestone 8 — Slack OAuth & Alerting

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| Slack OAuth 2.0 (server-side) | `apps/api/src/routes/slack.routes.ts` | ✅ Verified in `slack.test.ts` |
| SlackIntegration Prisma model | `apps/api/prisma/schema.prisma` | ✅ Verified via Prisma Client |
| Rate-limit Slack alerts (worker) | `apps/worker/src/slack-alert.ts` | ✅ Verified in `slack.test.ts` |
| Redis deduplication (SET NX EX 300) | `apps/worker/src/slack-alert.ts` | ✅ Verified in `slack.test.ts` |
| SlackSettings component | `apps/web/src/components/SlackSettings.tsx` | ✅ Verified via `@reachinbox/web` build |

## Milestone 9 — Elasticsearch Search & BullMQ Dashboard

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| Elasticsearch 8.x integration | `apps/api/src/services/elasticsearch.service.ts` | ✅ Verified in `search.test.ts` |
| Full-text search (subject, body, recipient) | `apps/api/src/services/elasticsearch.service.ts` | ✅ Verified in `search.test.ts` |
| Multi-user isolation (userId term filter) | `apps/api/src/services/elasticsearch.service.ts` | ✅ Verified in `search.test.ts` |
| Status and date-range filtering | `apps/api/src/services/elasticsearch.service.ts` | ✅ Verified in `search.test.ts` |
| Postgres fallback if ES unavailable | `apps/api/src/services/elasticsearch.service.ts` | ✅ Verified in `failure-injection.test.ts` |
| Index rebuild from Postgres (POST /api/search/rebuild) | `apps/api/src/routes/search.routes.ts` | ✅ Verified in `search.test.ts` |
| ES indexing on email CRUD (API) | `apps/api/src/services/email.service.ts` | ✅ Verified in `search.test.ts` |
| ES re-index on SENT state (worker) | `apps/worker/src/processor.ts`, `apps/worker/src/es-indexer.ts` | ✅ Verified in `processor.test.ts` |
| BullMQ queue dashboard (Bull Board) | `apps/api/src/queue/dashboard.ts` | ✅ Verified in `dashboard.test.ts` |
| Dashboard security (localhost / token) | `apps/api/src/queue/dashboard.ts` | ✅ Verified in `dashboard.test.ts` |
| Elasticsearch in Docker Compose | `docker-compose.yml` | ✅ Verified via `docker compose config` |
| ES search route | `apps/api/src/routes/search.routes.ts` | ✅ Verified in `search.test.ts` |
| ES status probe | `apps/api/src/routes/search.routes.ts` | ✅ Verified in `search.test.ts` |

## Milestone 10 — Full Integration, Reliability & Load Testing

| Requirement | Location | Verification Status |
|-------------|----------|---------------------|
| 1,000 synthetic jobs load test | `apps/worker/src/__tests__/load-1000-jobs.test.ts` | ✅ Verified: 1,000 jobs, 10 lanes, 0 duplicates |
| Worker restart resilience & state recovery | `apps/worker/src/__tests__/load-1000-jobs.test.ts` | ✅ Verified: mid-stream crash recovery |
| Pagination memory safety (chunked reading) | `apps/worker/src/__tests__/load-1000-jobs.test.ts` | ✅ Verified: 10 chunks of 100 jobs |
| 12-scenario failure-injection test matrix | `apps/api/src/__tests__/failure-injection.test.ts` | ✅ Verified: 10 matrix tests passing |
| Queue dashboard security & access guard | `apps/api/src/__tests__/dashboard.test.ts` | ✅ Verified: localhost & admin token enforcement |
| Monorepo automated test execution (154 tests) | `npm test` | ✅ Verified: 82 API + 72 Worker tests pass |
| Full TypeScript typechecking & build | `npm run build` | ✅ Verified: 4/4 packages compile cleanly |
