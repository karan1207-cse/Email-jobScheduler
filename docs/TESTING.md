# ReachInbox Email Job Scheduler — Testing & Reliability Guide

## Overview

The ReachInbox test suite is implemented using **Vitest** across the TypeScript monorepo workspaces. Tests are isolated, deterministic, and verify both happy paths and edge cases including network partitions, rate limit windows, atomic worker concurrency, ambiguous SMTP deliveries, and multi-user data isolation.

## Test Summary

```
Total Test Suites: 14
Total Tests:       154 passing (0 failed, 0 skipped)
API Workspace:     8 suites, 82 tests
Worker Workspace:  6 suites, 72 tests
Build Status:      Clean (TypeScript strict, 0 errors across 4 workspaces)
```

## Running Tests

### Full Monorepo Test Run
```bash
npm test
```

### API Workspace Only
```bash
npm run test:api
# or
npm test --workspace=@reachinbox/api
```

### Worker Workspace Only
```bash
npm run test:worker
# or
npm test --workspace=@reachinbox/worker
```

---

## Workspace Test Suites

### 1. API Workspace (`apps/api/src/__tests__`)

| Test File | Description | Test Count |
|-----------|-------------|------------|
| `api.test.ts` | Health probe (`/health`, `/ready`) and root routing | 3 |
| `auth.test.ts` | Google OAuth 2.0 exchange, session validation, cookie flags, and multi-user isolation | 9 |
| `email.test.ts` | Email CRUD, status transitions, Zod validation, and Idempotency-Key replay | 17 |
| `scheduler.test.ts` | Schedule submission, delayed job calculation, outbox creation, and email cancellation | 9 |
| `search.test.ts` | Elasticsearch query builder, multi-user filter, date range filters, and index rebuild | 16 |
| `slack.test.ts` | Slack OAuth, manual webhook configuration, test alerts, and rate-limit deduplication | 9 |
| `dashboard.test.ts` | BullMQ queue dashboard security, localhost-only dev guard, and admin token enforcement | 9 |
| `failure-injection.test.ts` | 12-scenario failure-injection matrix covering crash recovery, outage fallbacks, and security | 10 |

### 2. Worker Workspace (`apps/worker/src/__tests__`)

| Test File | Description | Test Count |
|-----------|-------------|------------|
| `bullmq-deferral.test.ts` | Verifies `DelayedError` inheritance: delayed jobs skip `failed` state and preserve attempts | 3 |
| `config.test.ts` | Environment parsing, concurrency limits, rate limit defaults, and SMTP settings | 8 |
| `mailer.test.ts` | Ethereal test transporter creation, multipart MIME assembly, credential isolation | 8 |
| `processor.test.ts` | Atomic claims, 120s processing lease, stale worker detection, ambiguous outcome recovery, and quarantine | 24 |
| `rate-limiter.test.ts` | Redis Lua sliding window script, hourly cap enforcement, pacing intervals, and fallback | 26 |
| `load-1000-jobs.test.ts` | 1,000 synthetic jobs load test, 10 concurrent lanes, observable bounce handling, and crash recovery | 3 |

---

## 1,000 Synthetic Jobs Load Test (Section 10.9)

A dedicated load test is located in `apps/worker/src/__tests__/load-1000-jobs.test.ts`.

### Test Characteristics
- **Volume**: Exactly 1,000 synthetic jobs generated in-memory.
- **Controlled Transport**: Uses mocked SMTP transport (no external network calls or real recipients).
- **Concurrency**: 10 concurrent worker lanes executing against the queue.
- **Error Injection**: Controlled failure injection on 15 designated recipient addresses to verify that errors are recorded in database `lastError` and `status: 'FAILED'` without stalling the remaining pipeline.
- **Duplicate Prevention**: Verifies zero duplicate logical processing under concurrency.
- **Mid-Stream Worker Crash Recovery**: Terminates worker at job #250, spins up worker instance B, reconciles state, and processes remaining 750 jobs to 100% completion.
- **Memory Safety & Pagination**: Tests batch/chunked reads (10 pages of 100 jobs) to ensure memory consumption remains linear and bounded.

### Measured Results
```
Total Synthetic Jobs:    1,000
Concurrent Worker Lanes: 10
Successfully Processed:  985
Controlled Failures:     15 (simulated mailbox unavailable)
Duplicate Sends:         0
Elapsed Time:            ~14 ms (in-memory mock pipeline)
Measured Throughput:     ~71,000 jobs/sec
```

---

## Failure-Injection Matrix (Section 10.10)

| Scenario | Tested Behavior | Verification Mode |
|---|---|---|
| **API restart** | Existing schedules remain intact in PostgreSQL; outbox recovers pending tasks | Automated test (`failure-injection.test.ts`) |
| **Worker restart** | Unsent jobs with expired leases or pending outbox events are recovered without duplicate sends | Automated test (`failure-injection.test.ts` & `load-1000-jobs.test.ts`) |
| **Redis outage** | Database transactions succeed; outbox events buffer in PostgreSQL and sync when Redis returns | Automated test (`failure-injection.test.ts`) |
| **PostgreSQL outage** | Authoritative writes fail safely with HTTP 500 without corrupting state | Automated test (`failure-injection.test.ts`) |
| **Elasticsearch outage** | Search falls back transparently to PostgreSQL with identical filters and pagination; sending unaffected | Automated test (`failure-injection.test.ts`) |
| **Slack outage** | Slack webhook failures return HTTP 502 with diagnostic info; email worker and rate limiting continue | Automated test (`failure-injection.test.ts`) |
| **SMTP rejection** | 5xx hard bounce transitions email to `FAILED` with diagnostic message in `lastError` | Automated test (`processor.test.ts` & `load-1000-jobs.test.ts`) |
| **Ambiguous SMTP result** | Worker loses ownership; conditional database updates prevent automatic double sends | Automated test (`processor.test.ts`) |
| **Invalid OAuth state** | Callbacks with missing or mismatched state parameters redirect with error | Automated test (`failure-injection.test.ts`) |
| **Cross-user request** | Tenant isolation ensures User B cannot view, query, update, or cancel User A's data | Automated test (`failure-injection.test.ts` & `auth.test.ts`) |
| **Duplicate scheduling** | Replaying request with same `Idempotency-Key` returns original record with `Idempotent-Replay: true` | Automated test (`email.test.ts` & `failure-injection.test.ts`) |
| **Rate limit reached** | Job is moved to delayed state using `DelayedError` without consuming retry attempts | Automated test (`rate-limiter.test.ts` & `processor.test.ts`) |
