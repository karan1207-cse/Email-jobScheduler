# End-to-End Acceptance Report

**Date:** October 17, 2026  
**Branch / starting commit:** `main` / `c584272`  
**Repository state at start:** clean working tree  
**Acceptance status (latest recheck):** Live Google OAuth sign-in, refresh persistence, logout, and protected-endpoint 401 passed. The worker image initially lacked the Prisma Client in the worker workspace; the worker Dockerfile now generates and copies the generated runtime client into that workspace. The worker was rebuilt and restarted in the Ubuntu VM. Two overdue jobs that had failed before SMTP were verified as still Scheduled, requeued, and accepted by the Ethereal test SMTP provider; PostgreSQL now records both as SENT, the BullMQ failed count is zero, and the dashboard displays Sent 2. Ethereal is a preview/test service, not delivery to a real inbox. Three future jobs remain Scheduled. Slack’s built-in test notification and a rate-limit alert both reported delivery. API health reports PostgreSQL and Redis up. Live search still missed visible mailbox matches because Elasticsearch returned zero hits; a PostgreSQL fallback plus regression test exist in source but are not deployed to the VM API. Latest local regression suite: 160 tests pass; full workspace build passes. The worker image build also passed in the VM.

## Summary

The latest API and worker suites pass (87 API + 73 worker tests), including a synthetic 1,000-job reliability test, attachment validation/storage/SMTP mapping, OAuth state checks, ownership checks, scheduler regression coverage, and a regression test for an incomplete Elasticsearch index. The complete shared/API/web/worker production build passes. The VM deployment includes the real attachment pipeline, security response headers, and colon-free BullMQ job IDs; all four Prisma migrations, including the attachment migration, are applied to the existing database volume. Frontend changes are being served in the live browser; the search-service fallback is not yet running in the VM API.

The Windows test/build commands required elevated filesystem access because this OneDrive-synced workspace otherwise raises `EPERM`. The Ubuntu application is deployed at `/home/kafka/Desktop/Email-jobScheduler`. Google OAuth, refresh persistence, logout, and unauthorized API rejection were verified live. For the mail-delivery issue, VM worker logs showed `@prisma/client did not initialize yet`. The original Prisma generation only populated `apps/api/node_modules`, while the worker resolves its separate `apps/worker/node_modules` package. `Dockerfile.worker` now generates the API client and copies both generated package and runtime engine artifacts into the worker workspace before compilation. The VM worker image rebuilt successfully; two overdue, still-SCHEDULED jobs were safely requeued only after confirming the failure occurred before SMTP, then the worker accepted both via Ethereal. DB status counts now show 2 SENT, 3 SCHEDULED, and 1 CANCELLED, with 0 failed BullMQ jobs. The dashboard’s Sent view visibly shows two sent messages. Slack settings showed Connected to ReachInbox; both the built-in test and the live rate-limit alert reported delivery. Live `/health` returned healthy with PostgreSQL and Redis up. The host browser’s `/admin/queues` endpoint remains protected by its localhost-only development guard.

The production dependency audit still reports three high-severity `deepmerge-ts` findings through Prisma CLI configuration. npm only offers an automatic Prisma 7 major upgrade, so the dependency was not force-upgraded without a migration plan.

## Checklist coverage from the latest run

| Area | Result | Evidence / remaining acceptance |
|---|---|---|
| A. Website and dashboard | Partial | Live app renders and shows API-backed scheduled records; composer controls render. The exhaustive responsive/navigation browser walkthrough was not completed. |
| B. Authentication and authorization | Partial | Live Google OAuth and refresh persistence passed; logout returned to Login and a protected email request returned 401. Cross-user isolation is covered by tests, not live-tested. |
| C. Email management | Partial | UI-to-API creation, list persistence, detail view, status filtering, and cancellation of the synthetic test job were verified. No edit/reschedule flow was run. |
| D. Scheduler and worker | Pass for live due-job processing; partial overall | After repairing the worker image, two overdue Scheduled jobs were requeued and processed; the queue failed count returned to 0. Future schedules remain persisted. Restart recovery after the fix, timezone/DST E2E, and multiple-worker runtime behavior remain unverified. |
| E. SMTP and delivery | Pass through test SMTP; real inbox not verified | Both overdue jobs were accepted by Ethereal and have message IDs/preview URLs in worker logs; PostgreSQL marks them SENT. Ethereal previews do not prove delivery to a real recipient inbox. SMTP rejection/timeout and attachment mapping are covered by tests. |
| F. Rate limits and multiple senders | Partial | Shared Redis limiter, pacing, and synthetic concurrency tests pass. Live multi-worker throughput and a delivered Slack limit alert were not verified. |
| G. Slack integration | Partial | Live settings show Connected to ReachInbox, and the built-in test action reported “Test alert delivered to Slack channel!” OAuth state/lifecycle, webhook validation, and failure-isolation tests pass. Rate-limit-triggered alert remains untested. |
| H. Search and queue monitoring | Partial / live search mismatch found | Live search for a visible subject returned zero results from reachable Elasticsearch. Source now falls back to PostgreSQL on zero-hit text searches and has a regression test; API change is not deployed. The status funnel now filters supported states, and frontend status badges/details show the actual state/body. The BullMQ link targets `API_BASE_URL`, but the API endpoint remains localhost-guarded and returned 403 from the host browser, so queue-state inspection remains unverified. |
| I. API, database, and security | Partial | Real DB/Redis health, all four migrations, attachment column, ownership tests, CORS/session behavior, and security headers verified. Dependency audit retains three high Prisma CLI transitive advisories. |
| J. Docker, builds, and release readiness | Partial | VM Compose build succeeds and all six services are running; host production build and all 159 API/worker tests pass. `lint` is only an alias for build; no separate lint, frontend unit, or browser E2E suite is configured. |

Remaining live acceptance: inspect/restart the VM worker, determine why the due message remains Scheduled, complete a test-provider delivery and verify terminal status, and observe the queue dashboard from within the VM loopback. Slack’s configured test alert succeeded; a rate-limit-triggered alert remains to be exercised.

## Initial state and project map

- Starting commit: `c584272` (`fix(worker): attach error listener to worker Redis connections and handle shutdown cleanly`); recent history also contains reliability, dashboard, and frontend feature work.
- No `AGENTS.md` or `.github` CI workflow files were found. The repository uses npm workspaces and `package-lock.json`; Docker images use Node 20. The local host is Node `v24.19.0` with npm `11.17.0`.
- `apps/web` is the React/Vite frontend; `apps/api` is the Express API and Prisma database client; `apps/worker` processes BullMQ jobs; PostgreSQL is authoritative storage, Redis backs BullMQ/rate limiting, Elasticsearch is a rebuildable search index, and SMTP/Ethereal plus Slack OAuth/webhooks are external integrations.
- Prisma migrations present: `20261016_init`, `20261017_add_processing_owner_and_lease`, and `20261017_add_slack_integration`.
- Root scripts: `npm test` runs API then worker tests; `npm run build` builds shared, API, web, and worker workspaces; `npm run lint` currently aliases the build and does not run a separate linter.
- `.env`, `apps/api/.env`, and `apps/worker/.env` are ignored by Git. Their contents were not displayed or included in this report. `.env.example` is tracked and contains placeholders/local defaults only.

## Defect found and repair

The worker depended on Nodemailer `^6.10.1`, which the npm security audit reported in multiple high-severity vulnerable ranges. The API already used Nodemailer `^10.1.2`, a version outside the reported affected range. The worker dependency was aligned to `^10.1.2` and `package-lock.json` was refreshed. The full test suite passed after this change.

The audit also flags `deepmerge-ts` through Prisma 6's `@prisma/config` dependency. npm only offered Prisma `7.10.1` as an automatic fix, which is a major-version change. Prisma was not force-upgraded because the repository's schema/client build and runtime configuration would require a deliberate migration. Track a compatible Prisma release/path and upgrade after validating the Prisma 7 migration requirements.

The follow-up source audit found and corrected several runtime/security issues while keeping the existing screen layout: failed email login no longer creates a fake session; the API no longer creates authenticated sessions from an unverified email/password pair; anonymous development requests no longer get a shared default user; email and scheduler controllers now rely on the authenticated session; search no longer falls back to a hardcoded user ID; and the dashboard no longer fabricates email rows or counts. Search pagination is adapted to the frontend response shape, the compose hourly cap now affects campaign spacing, and the worker honors `EMAIL_QUEUE_NAME` like the API. Email/password login remains explicitly unavailable; Google OAuth is the configured login path.

## Commands and results

| Command / check | Result |
|---|---|
| `git status --short`; `git branch --show-current`; `git log -5 --oneline` | Clean baseline; branch `main`; head `c584272`. |
| `node --version`; `npm --version` | Node `v24.19.0`; npm `11.17.0`. |
| `npm test` (initial sandbox attempt) | Could not collect tests: Vite `EPERM` resolving files in OneDrive. |
| `npm test` (elevated filesystem access, before dependency repair) | PASS: API 8 files / 82 tests; worker 6 files / 72 tests. |
| `npm install --workspace=@reachinbox/worker nodemailer@^10.1.2` | PASS; updated worker manifest and lockfile. npm reported remaining audit findings. Install-script allow-list warnings were emitted; no script approval was applied. |
| `npm test` (after repair, elevated filesystem access) | PASS: 154 tests total (82 API, 72 worker). Worker suite includes 1,000 synthetic jobs; its test report recorded 985 successful synthetic sends, 15 observable failures, and 0 duplicates. |
| `npm test` (follow-up auth/dashboard fixes, elevated filesystem access) | PASS: API 84 tests and worker 72 tests. Test-only fixture authentication remains isolated to `NODE_ENV=test`. |
| `npm run build` (baseline and repeated after repair, elevated) | BLOCKED at `prisma generate`: `EPERM` renaming `apps/api/node_modules/.prisma/client/query_engine-windows.dll.node.tmp…` to `query_engine-windows.dll.node`. Shared TypeScript build completed first. |
| `npx tsc -p apps/api/tsconfig.json --noEmit` | PASS. |
| `npx tsc -p apps/worker/tsconfig.json --noEmit` | PASS after Nodemailer update. |
| `npm run build --workspace=@reachinbox/web` (sandbox) | Blocked by `EPERM` resolving `apps/web/src/main.tsx`. |
| `npm run build --workspace=@reachinbox/web` (elevated filesystem access) | PASS: TypeScript and Vite production build; 35 modules transformed. |
| `npm run build:web` (follow-up UI/data fixes, elevated filesystem access) | PASS: TypeScript and Vite production build; 35 modules transformed. |
| `npm run build:worker` | PASS: TypeScript build. |
| `npx tsc --noEmit -p apps/api/tsconfig.json` (follow-up auth/search fixes) | PASS. |
| `GET /ready` (follow-up) | Added a readiness alias for the existing database and Redis health check, with automated coverage. |
| `npm run build:api` (follow-up) | BLOCKED during `prisma generate`: OneDrive/Windows denied replacing `query_engine-windows.dll.node`, including elevated filesystem access. API TypeScript compilation independently passes. |
| `npm exec --workspace=@reachinbox/api -- prisma validate --schema=prisma/schema.prisma` | PASS: schema valid. |
| `docker compose config --quiet` | PASS: Compose file parses. |
| `docker info --format '{{.ServerVersion}}'` | BLOCKED: Docker Desktop engine access did not return a version; initial Docker CLI attempt reported permission denied for `dockerDesktopLinuxEngine`. A later check also hung without output. |
| `docker compose up --build -d` (October 17 follow-up) | BLOCKED: command hung without output for over two minutes; interrupted. `docker compose ps` also hung. A subsequent process/listener check found no Docker Desktop processes and none of the app/database/cache/search ports listening. No containers were confirmed started. |
| Ubuntu VM recovery (October 17) | PASS: identified running `ubundt desktop` Oracle VirtualBox VM, guest IP `10.0.2.15`, Ubuntu guest with Docker bridge interfaces. Added localhost-only NAT forwards. The application was rebuilt from the repaired source and all six Compose services are now running; API health, web response, and both OAuth redirects were verified. No VM disk or container volume was reset. |
| VM OAuth configuration | PASS: copied only the six Google/Slack OAuth settings from the supplied config to the ignored VM `.env`; preserved other values, set mode 0600, and confirmed Git ignores the file. Recreated the API to load settings. Secret values were not printed. |
| VM worker Prisma repair (October 17) | PASS: worker logs isolated missing generated Prisma Client. Updated `Dockerfile.worker` to copy the generated API client/runtime engine into the distinct worker workspace, rebuilt and restarted only the worker, then requeued only two overdue records still marked SCHEDULED. Both completed through Ethereal, DB counts became SENT=2/SCHEDULED=3/CANCELLED=1, and BullMQ failed count became 0. |
| `docker exec ... npm test` (Ubuntu VM, isolated test environment) | PASS: API 84/84 and worker 72/72 (156 total). The search outage test now rejects the actual Elasticsearch client's ping, so the failure simulation remains valid when Elasticsearch is running. |
| `npm audit --omit=dev` (sandbox) | Could not reach `registry.npmjs.org` due sandbox DNS/network restriction. |
| `npm audit --omit=dev` (elevated network access) | FAIL: reports three high-severity findings from `deepmerge-ts` via Prisma CLI configuration. The worker Nodemailer finding no longer appears. |
| `git check-ignore .env .env.example apps/api/.env apps/worker/.env` | `.env` and both nested `.env` files are ignored; `.env.example` remains tracked. |

## Integration and security evidence

- **Database/migrations:** The API container applied `prisma migrate deploy`; it reported no pending migrations. VM `/health` reports PostgreSQL and Redis up, and `/ready` returns 200.
- **Email lifecycle:** Live UI-to-API scheduling and mailbox persistence were verified. Two overdue Scheduled jobs previously failed before SMTP because the worker’s Prisma Client was missing; after the image fix they were requeued, processed, and persisted as SENT. The dashboard Sent view shows both. The future jobs remain scheduled. API and worker tests cover cancellation, outbox recovery, ownership, retry/failure paths, and concurrency using test doubles.
- **SMTP:** Ethereal accepted both requeued jobs; the worker logged message IDs and preview URLs, and the database marked them SENT. This verifies SMTP submission to the test provider, not arrival in a real recipient inbox. SMTP rejection, timeout, and attachment mapping tests passed.
- **Authentication/authorization:** Live Google OAuth consent/callback completed successfully. OAuth state, session/logout behavior, and cross-user ownership test coverage pass. Cross-user isolation and logout were not exercised in the live UI.
- **Slack:** Live settings showed a connection to workspace ReachInbox; the built-in test and rate-limit-triggered alert both reported delivery.
- **Docker/browser:** Live API health returned healthy with database and Redis up. The worker image was built and restarted in the VM. The development queue dashboard now allows only the configured Google-authenticated admin account when accessed through the host-to-VM port forward; unauthenticated and non-admin access remain denied. After re-authenticating, Bull Board rendered live in the browser and showed the `email-jobs` queue with 1,002 jobs (9 completed, 993 delayed, none failed at the time of inspection). The browser Sent view visibly shows the sent emails.
- **Security:** Corrected the vulnerable worker Nodemailer version. The remaining Prisma CLI dependency audit finding requires a planned Prisma major upgrade. No credentials were printed. `.env` files remain ignored.

## Remaining blockers and next actions

1. **Real inbox delivery:** The current setup uses Ethereal because SMTP credentials are empty. Configure a controlled SMTP/test inbox in the VM `.env` to prove real mailbox arrival; do not use production recipients for tests.
2. **Search deployment:** Deploy the local PostgreSQL fallback for reachable Elasticsearch zero-hit searches to the VM API and verify it against the visible mailbox query.
3. **Remaining live coverage:** Test worker restart recovery, SMTP rejection/timeouts, cancellation race, cross-user isolation, DST boundaries, and queue dashboard authorization end-to-end.
4. **Prisma security audit:** Review the Prisma 7 migration and select a compatible supported version; upgrade Prisma and client together only after regenerating the client and rerunning schema, migration, build, and test checks.
5. **Credentials:** The VM `.env` contains OAuth configuration. Keep it out of Git and chat; rotate the Ubuntu account password shared in this conversation. Do not expose SMTP or OAuth secrets in logs.
