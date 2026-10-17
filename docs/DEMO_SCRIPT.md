# ReachInbox Email Job Scheduler — 5-Minute Video Demonstration Script

## Overview

This script is structured for a concise, professional screen recording (≤ 5:00) showcasing the ReachInbox Full-Stack Email Job Scheduler in action.

---

## Pre-Recording Checklist & Environment Setup

Before starting the screen recording:
1. **Infrastructure running**:
   ```bash
   docker compose up -d
   ```
2. **Database migrated & indexed**:
   ```bash
   npm run prisma:migrate --workspace=apps/api
   curl -X POST http://localhost:5000/api/search/rebuild
   ```
3. **Application services started**:
   ```bash
   # Terminal 1: API
   npm run dev:api
   # Terminal 2: Worker
   npm run dev:worker
   # Terminal 3: Web
   npm run dev:web
   ```
4. **Browser tabs arranged**:
   - Tab 1: Frontend App (`http://localhost:5173`)
   - Tab 2: BullMQ Queue Dashboard (`http://localhost:5000/admin/queues`)
   - Tab 3: API Status & Health (`http://localhost:5000/health`)
   - Tab 4: Ethereal Mailbox Portal (`https://ethereal.email`)

---

## Safe Demo Data Reference

| Field | Demo Value |
|---|---|
| User Name | Alex Morgan (Product Operations) |
| User Email | alex.morgan@reachinbox.test |
| Campaign Subject | Welcome to Acme Alpha: Exclusive Early Access |
| Campaign Body | Hi {{name}}, thrilled to have you onboard Acme Alpha. Your access link is active. |
| CSV Leads | `name,email`<br>`Sarah Connor,sarah@techcorp.test`<br>`Marcus Vance,marcus@enterprises.test`<br>`Elena Rostova,elena@global.test` |
| Pacing Delay | 2000 ms (2 seconds between sends) |
| Hourly Cap | 100 emails/hr |

---

## Minute-by-Minute Screenplay

### 0:00 – 0:30 | Introduction & Architecture Overview
- **Visual**: Show system architecture diagram from `README.md` or code structure in IDE.
- **Narrator**:
  > *"Welcome to this walkthrough of the ReachInbox Email Job Scheduler. We built a distributed, production-grade email campaign engine engineered with Node.js, TypeScript, Express, PostgreSQL, Redis with BullMQ, Elasticsearch 8, and React.*
  > *Core architectural pillars: PostgreSQL is the authoritative source of truth, BullMQ manages durable delayed jobs, Redis Lua scripts coordinate distributed rate limiting and send pacing, and workers atomically claim and process deliveries without risking duplicate sends."*

### 0:30 – 1:10 | Google OAuth Sign-In & Dashboard Navigation
- **Visual**: Browser Tab 1 (`http://localhost:5173`).
- **Action**:
  1. Click **Sign in with Google** button.
  2. Authenticate through the simulated/real Google OAuth consent screen.
  3. Land on the unified Campaign Dashboard.
- **Narrator**:
  > *"Authentication is handled entirely server-side using Google OAuth 2.0. Sessions are secured with HTTP-only, SameSite=Lax cookies, isolating campaigns per tenant so no user can view or modify another user's leads, drafts, or delivery logs."*

### 1:10 – 2:00 | Campaign Composition & Lead Upload
- **Visual**: Campaign Composer tab in frontend.
- **Action**:
  1. Enter Subject: `Welcome to Acme Alpha: Exclusive Early Access`.
  2. Paste email content into the rich text editor.
  3. Click **Upload Leads** and select a demo CSV file or paste the 3 demo leads.
  4. Observe instant parsing, deduplication, and syntax validation.
- **Narrator**:
  > *"The Campaign Composer allows manual entry or bulk CSV/TXT parsing. The client sanitizes entries, deduplicates addresses, and displays a preview count before scheduling."*

### 2:00 – 2:45 | Scheduling & Persistent BullMQ Dispatch
- **Visual**: Scheduling modal / controls in Composer.
- **Action**:
  1. Set **Start Time** to 30 seconds from now.
  2. Set **Send Pacing Interval** to 2 seconds.
  3. Click **Schedule Campaign**.
  4. Switch immediately to the **Scheduled** tab — observe the live countdown badge.
- **Narrator**:
  > *"When scheduled, the API executes a transactional write: persisting the email records and an OutboxEvent in PostgreSQL before enqueuing BullMQ delayed jobs in Redis. Even if the API restarts right now, jobs remain durable in PostgreSQL and Redis."*

### 2:45 – 3:30 | Status Tracking & Elasticsearch Search
- **Visual**: Dashboard transitions + search bar.
- **Action**:
  1. Watch countdown reach 0: status updates from `SCHEDULED` → `PROCESSING` → `SENT`.
  2. Worker terminal outputs Ethereal preview link: click to preview the rendered MIME message.
  3. In the search box, type `Acme Alpha` and filter by status `SENT`.
  4. Search results filter instantly; toggle date range.
- **Narrator**:
  > *"Worker processes pick up the jobs, atomically acquire a 120-second lease, enforce pacing, and dispatch via SMTP. Once marked SENT, Elasticsearch indexes the record for sub-millisecond search across subject, body, and recipient, complete with tenant isolation and Postgres fallback."*

### 3:30 – 4:10 | Distributed Rate Limiting & Slack Alerting
- **Visual**: Trigger quick succession of sends or view Slack notification settings.
- **Action**:
  1. Show Slack settings panel with webhook configured.
  2. Show worker log output when hourly cap or pacing triggers:
     `[Worker] ⏳ Rate limited: Send pacing: minimum 2000ms. Deferring job.`
  3. Show the resulting Slack alert notification.
- **Narrator**:
  > *"When sending exceeds configured thresholds, our distributed Lua rate limiter returns a precise retry-after window. The worker defers the job with BullMQ's DelayedError sentinel—ensuring no attempts are consumed and no jobs are dropped. The first rate-limit trigger alerts the team via Slack, deduplicated by a 5-minute Redis key."*

### 4:10 – 4:40 | BullMQ Queue Dashboard
- **Visual**: Tab 2 (`http://localhost:5000/admin/queues`).
- **Action**:
  1. Refresh the Bull Board dashboard.
  2. Show `email-jobs` queue status: active, completed, delayed, failed.
  3. Click a completed job to show payload and retry metadata.
- **Narrator**:
  > *"The Bull Board administrative dashboard provides real-time operational visibility into queue depths, throughput, and job states. In development, access is strictly localhost-guarded; in production, an X-Admin-Token header is required."*

### 4:40 – 5:00 | Testing & Reliability Summary
- **Visual**: Terminal showing test suite results.
- **Action**:
  1. Run `npm test` or display the passing Vitest summary:
     `14 passed, 154 tests passing`.
  2. Highlight the 1,000 synthetic jobs load test and failure-injection matrix.
- **Narrator**:
  > *"The system is thoroughly verified with 154 automated tests across API and worker workspaces, an end-to-end 1,000 synthetic jobs load test, and a 12-scenario failure matrix covering crash recovery and ambiguous delivery handling. Thank you!"*

---

## Fallback & Contingency Procedures

| Potential Glitch during Recording | Immediate Fix |
|---|---|
| Ethereal SMTP slow | Ethereal auto-generates test credentials on launch; check terminal for the generated URL. |
| Elasticsearch not running | Search automatically falls back to PostgreSQL without throwing an error; mention this live. |
| Slack webhook invalid | Test notification endpoint validates URLs; use `https://hooks.slack.com/services/...` format or mock direct notification. |
| Bull Board 403 Forbidden | Ensure browser is browsing to `http://localhost:5000/admin/queues` from `127.0.0.1`. |
