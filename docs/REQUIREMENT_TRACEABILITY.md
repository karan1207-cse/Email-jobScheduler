# Requirement Traceability Matrix

Maps assignment requirements to implementation locations.

## Milestone 1 — Monorepo & Shared Foundation

| Requirement | Location |
|-------------|----------|
| TypeScript monorepo with workspaces | `package.json`, `tsconfig.base.json` |
| Shared types package | `packages/shared/` |
| Docker Compose (Postgres, Redis) | `docker-compose.yml` |

## Milestone 2 — Database & REST API

| Requirement | Location |
|-------------|----------|
| Prisma schema (Email, User, LeadBatch, Lead, OutboxEvent) | `apps/api/prisma/schema.prisma` |
| CRUD endpoints for emails | `apps/api/src/routes/email.routes.ts` |
| Idempotency key support | `apps/api/src/services/email.service.ts` |
| Input validation (Zod) | `apps/api/src/validations/email.schema.ts` |

## Milestone 3 — BullMQ Delayed Scheduling

| Requirement | Location |
|-------------|----------|
| POST /api/schedule — schedule email | `apps/api/src/routes/scheduler.routes.ts` |
| POST /api/cancel — cancel scheduled email | `apps/api/src/routes/scheduler.routes.ts` |
| BullMQ delayed job creation | `apps/api/src/services/scheduler.service.ts` |
| Transactional outbox pattern | `apps/api/src/services/outbox.service.ts` |
| BullMQ worker processes jobs | `apps/worker/src/processor.ts` |

## Milestone 4 — Distributed Rate Limiting

| Requirement | Location |
|-------------|----------|
| Redis Lua atomic rate limiter | `apps/worker/src/rate-limiter.ts` |
| Hourly limit per user | `apps/worker/src/rate-limiter.ts` |
| Pacing interval enforcement | `apps/worker/src/rate-limiter.ts` |
| DelayedError on rate limit | `apps/worker/src/processor.ts` |

## Milestone 5 — SMTP Reliability

| Requirement | Location |
|-------------|----------|
| Atomic SCHEDULED→PROCESSING claim | `apps/worker/src/processor.ts` |
| Lease-based stale worker detection | `apps/worker/src/processor.ts` |
| SMTP failure → SCHEDULED or FAILED | `apps/worker/src/processor.ts` |
| Ambiguous delivery: PostSendDatabaseError | `apps/worker/src/processor.ts` |
| Localized DB retry (3x) after SMTP accept | `apps/worker/src/processor.ts` |
| Ethereal test SMTP integration | `apps/worker/src/mailer.ts` |

## Milestone 6 — Authentication & Multi-User Isolation

| Requirement | Location |
|-------------|----------|
| Google OAuth 2.0 (server-side) | `apps/api/src/routes/auth.routes.ts` |
| Session management (HTTP-only cookie) | `apps/api/src/app.ts` |
| requireAuth middleware | `apps/api/src/middleware/auth.js` |
| userId scoping on all email endpoints | `apps/api/src/services/email.service.ts` |

## Milestone 7 — React Frontend

| Requirement | Location |
|-------------|----------|
| Campaign Composer | `apps/web/src/App.tsx` |
| CSV/TXT lead parser | `apps/web/src/App.tsx` |
| Scheduled/Sent/Draft/Failed tables | `apps/web/src/App.tsx` |
| Live countdown timers | `apps/web/src/App.tsx` |
| System health telemetry | `apps/web/src/App.tsx` |
| Google OAuth login UI | `apps/web/src/App.tsx` |

## Milestone 8 — Slack OAuth & Alerting

| Requirement | Location |
|-------------|----------|
| Slack OAuth 2.0 (server-side) | `apps/api/src/routes/slack.routes.ts` |
| SlackIntegration Prisma model | `apps/api/prisma/schema.prisma` |
| Rate-limit Slack alerts (worker) | `apps/worker/src/slack-alert.ts` |
| Redis deduplication (SET NX EX 300) | `apps/worker/src/slack-alert.ts` |
| SlackSettings component | `apps/web/src/components/SlackSettings.tsx` |

## Milestone 9 — Elasticsearch Search & BullMQ Dashboard

| Requirement | Location |
|-------------|----------|
| Elasticsearch 8.x integration | `apps/api/src/services/elasticsearch.service.ts` |
| Full-text search (subject, body, recipient) | `apps/api/src/services/elasticsearch.service.ts` |
| Multi-user isolation (userId term filter) | `apps/api/src/services/elasticsearch.service.ts` |
| Status and date-range filtering | `apps/api/src/services/elasticsearch.service.ts` |
| Postgres fallback if ES unavailable | `apps/api/src/services/elasticsearch.service.ts` |
| Index rebuild from Postgres (POST /api/search/rebuild) | `apps/api/src/routes/search.routes.ts` |
| ES indexing on email CRUD (API) | `apps/api/src/services/email.service.ts` |
| ES re-index on SENT state (worker) | `apps/worker/src/processor.ts`, `apps/worker/src/es-indexer.ts` |
| BullMQ queue dashboard (Bull Board) | `apps/api/src/queue/dashboard.ts` |
| Dashboard security (localhost / token) | `apps/api/src/queue/dashboard.ts` |
| Elasticsearch in Docker Compose | `docker-compose.yml` |
| ES search route | `apps/api/src/routes/search.routes.ts` |
| ES status probe | `apps/api/src/routes/search.routes.ts` |
