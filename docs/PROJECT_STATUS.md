# ReachInbox Email Job Scheduler — Project Status

## Current Version: Milestone 9 Complete

| Milestone | Feature | Status |
|-----------|---------|--------|
| 1 | Monorepo & Shared Foundation | ✅ Complete |
| 2 | PostgreSQL Database & REST API | ✅ Complete |
| 3 | Persistent Email Scheduling (BullMQ) | ✅ Complete |
| 4 | Distributed Rate Limiting & Send Pacing | ✅ Complete |
| 5 | SMTP Reliability & Ambiguous-Delivery Handling | ✅ Complete |
| 6 | Google OAuth & Multi-User Data Isolation | ✅ Complete |
| 7 | React Frontend (Campaign Composer, Live Dashboard) | ✅ Complete |
| 8 | Slack OAuth & Rate-Limit Alerting | ✅ Complete |
| 9 | Elasticsearch Search & BullMQ Queue Dashboard | ✅ Complete |

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Browser (React + TypeScript)                   │
│  apps/web  — Campaign Composer, Live Dashboard  │
└──────────────────────┬──────────────────────────┘
                       │ HTTP + Cookies
┌──────────────────────▼──────────────────────────┐
│  Express API  (apps/api, port 5000)             │
│  ├── Auth:      /auth/google, /auth/slack       │
│  ├── Emails:    /api/emails                     │
│  ├── Scheduler: /api/schedule, /api/cancel      │
│  ├── Search:    /api/search/emails   ← NEW M9   │
│  ├── Rebuild:   /api/search/rebuild  ← NEW M9   │
│  └── Dashboard: /admin/queues        ← NEW M9   │
└────────┬──────────────────────┬─────────────────┘
         │ Prisma ORM           │ BullMQ
┌────────▼──────┐     ┌────────▼──────────────────┐
│  PostgreSQL   │     │  Redis                    │
│  (source of   │     │  ├── BullMQ queues         │
│   truth)      │     │  ├── Rate limiting Lua     │
└───────────────┘     │  └── Slack dedup SET NX   │
                      └───────────────────────────┘
┌───────────────────────────────────────────────────┐
│  BullMQ Worker (apps/worker)                      │
│  ├── Atomic claim (SCHEDULED→PROCESSING)          │
│  ├── Distributed rate limiter                     │
│  ├── Ethereal / SMTP delivery                     │
│  ├── Ambiguous delivery handling                  │
│  ├── Slack alerting                               │
│  └── ES re-index on SENT/FAILED       ← NEW M9   │
└───────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────┐
│  Elasticsearch 8.x                    ← NEW M9   │
│  Index: reachinbox_emails                         │
│  • Full-text search: subject, body, recipient     │
│  • Filters: status, date range                    │
│  • Multi-user isolation via userId term filter    │
│  • Postgres fallback if ES is unavailable         │
└───────────────────────────────────────────────────┘
```

## Service URLs (local development)

| Service | URL |
|---------|-----|
| API | http://localhost:5000 |
| Frontend | http://localhost:5173 |
| Queue Dashboard | http://localhost:5000/admin/queues (localhost-only) |
| Elasticsearch | http://localhost:9200 |
| ES Search | http://localhost:5000/api/search/emails |
| ES Status | http://localhost:5000/api/search/status |

## Test Summary

All tests pass via `npm test` at the monorepo root.

| Package | Tests |
|---------|-------|
| @reachinbox/api | api, auth, email, scheduler, slack, **search** |
| @reachinbox/worker | processor, rate-limiter |
| @reachinbox/shared | (type-only) |
