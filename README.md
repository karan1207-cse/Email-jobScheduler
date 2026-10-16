# ReachInbox — Full-Stack Email Job Scheduler

Production-grade, distributed email scheduling platform foundation built with React, Vite, Node.js, Express, TypeScript, PostgreSQL (Prisma ORM), and Redis.

---

## 1. Project Overview

ReachInbox is an enterprise-ready delayed email delivery platform. The system is designed to handle high-throughput email scheduling with granular concurrency control, retry policies, delivery auditing, and fault tolerance.

### Implementation Status
- **Milestone 1 — System Foundation (COMPLETED):** Monorepo architecture, npm workspaces, strict TypeScript configuration, shared contracts package, Express REST API with real PostgreSQL & Redis health probes, React + Vite frontend with live telemetry dashboard, and Docker Compose development services.
- **Milestone 2 — Database Schema & Email API (COMPLETED):** Prisma ORM integration, PostgreSQL relational data models (`User`, `Email`, `Lead`, `LeadBatch`, `OutboxEvent`), repeatable migrations, Email draft CRUD endpoints with Zod validation, Idempotency-Key support, and Transactional Outbox atomic scheduling pattern.

> [!NOTE]
> **Features Deliberately Deferred to Later Milestones:**
> - **Milestone 3:** BullMQ queue engine, delayed email dispatcher, worker process, Ethereal test SMTP integration, background outbox event processing.
> - **Milestone 4:** Google OAuth 2.0 authentication, Slack rate-limit webhook notifications, Elasticsearch search index, and complete analytics dashboard.

---

## 2. Technology Stack

- **Monorepo:** npm workspaces
- **Backend API:** Node.js (v20+ / v24+), Express 4, TypeScript, Prisma ORM 6, pg, ioredis, Zod
- **Frontend App:** React 18, Vite 6, TypeScript, Lucide Icons, Modern Vanilla CSS Design System
- **Database:** PostgreSQL 16 (Alpine) managed via Prisma Client
- **In-Memory Store & Queue Broker:** Redis 7 (Alpine with Append-Only File `AOF` persistence)
- **Scaffold Worker:** Dedicated worker package for future BullMQ background job processing
- **Testing:** Vitest, Supertest (23 automated integration & unit tests)

---

## 3. Repository Structure

```text
reachinbox-email-scheduler/
├── apps/
│   ├── api/                     # Express + TypeScript REST API
│   │   ├── prisma/
│   │   │   ├── migrations/      # Repeatable SQL migrations (20261016_init)
│   │   │   └── schema.prisma    # Prisma relational schema (User, Email, Lead, OutboxEvent)
│   │   ├── src/
│   │   │   ├── __tests__/       # Vitest route, idempotency & health probe test suite
│   │   │   ├── controllers/     # HTTP route controllers for emails and health
│   │   │   ├── db/              # Prisma client & PostgreSQL pool connection
│   │   │   ├── middleware/      # Zod validation & centralized error handlers
│   │   │   ├── redis/           # ioredis client & PING health probe
│   │   │   ├── routes/          # Express route definitions (/api/emails, /, /health)
│   │   │   ├── services/        # Business logic: email.service.ts & outbox.service.ts
│   │   │   ├── validations/     # Zod request validation schemas
│   │   │   ├── app.ts           # Express application factory (CORS, JSON, routes)
│   │   │   ├── config.ts        # Environment loading & validation
│   │   │   └── index.ts         # Server boot & graceful shutdown
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/                     # React + Vite + TypeScript Frontend
│   │   ├── src/
│   │   │   ├── components/      # Header, HealthCard, MilestoneOverview, Footer
│   │   │   ├── api.ts           # Real backend fetch client
│   │   │   ├── App.tsx          # Real-time health dashboard & Email Draft test console
│   │   │   ├── index.css        # Modern design system & CSS tokens
│   │   │   └── main.tsx         # React DOM root entrypoint
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── worker/                  # Background Worker Scaffold (Milestone 3)
│       ├── src/
│       │   └── index.ts         # Worker scaffold placeholder
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/                  # Shared TypeScript Contracts & Types
│       ├── src/
│       │   └── index.ts         # EmailDto, CreateEmailInput, HealthCheckResponse, etc.
│       ├── package.json
│       └── tsconfig.json
├── .env.example                 # Tracked example environment template
├── .gitignore                   # Excludes node_modules, dist, .env, scratch
├── docker-compose.yml           # Pinned PostgreSQL 16 & Redis 7 services
├── package.json                 # Monorepo root workspace configuration
├── package-lock.json            # Deterministic lockfile
├── tsconfig.base.json           # Strict base TypeScript compiler options
└── README.md                    # Project documentation
```

---

## 4. Database Schema (Prisma)

### Data Models Summary

1. **`User` (`users` table):**
   - Represents email owners and account holders.
   - Fields: `id` (UUID), `email` (unique), `displayName`, `providerId` (for future OAuth), `createdAt`, `updatedAt`.
   - Relations: `emails`, `leads`, `batches`.

2. **`Email` (`emails` table):**
   - Core entity for draft, scheduled, and delivered messages.
   - Fields: `id` (UUID), `userId` (FK to User), `recipient` (varchar 320), `subject` (varchar 500), `body` (text), `status` (`DRAFT`, `SCHEDULED`, `PROCESSING`, `SENT`, `FAILED`, `CANCELLED`), `scheduledTime`, `sentAt`, `idempotencyKey`, `requestFingerprint` (SHA-256), `attemptCount`, `lastError`, `createdAt`, `updatedAt`.
   - Constraints & Indexes:
     - `@@unique([userId, idempotencyKey])`: Enforces idempotency key uniqueness per user.
     - `@@index([userId, status])`: Fast lookup for user emails filtered by status.
     - `@@index([status, scheduledTime])`: Optimized query for scheduler polling.
     - `@@index([createdAt])`: Efficient reverse chronological pagination.

3. **`Lead` & `LeadBatch` (`leads`, `lead_batches` tables):**
   - Supports imported recipient contacts and batch associations.
   - Decoupled from immediate sending logic for clean campaign scaling.

4. **`OutboxEvent` (`outbox_events` table):**
   - Reliable transactional outbox pattern to bridge PostgreSQL state with background message queues (Redis / BullMQ).
   - Fields: `id` (UUID), `eventType` (`EMAIL_SCHEDULED`), `aggregateId` (email ID), `payload` (JSONB), `status` (`PENDING`, `PROCESSED`, `FAILED`), `attemptCount`, `lastError`, `processedAt`, `createdAt`.
   - Indexes:
     - `@@index([status, createdAt])`: Efficient polling for pending events.

### Prisma Migration Commands

```powershell
# Generate Prisma Client after schema changes
npm run prisma:generate --workspace=@reachinbox/api

# Apply migrations to configured database (Production / CI)
npm run prisma:migrate --workspace=@reachinbox/api

# Create a new migration during development
npx prisma migrate dev --name <migration_name> --schema=apps/api/prisma/schema.prisma
```

---

## 5. Email API Specification (Milestone 2)

All endpoints are mounted under `/api/emails`.

### Ownership & Authentication Note
> [!IMPORTANT]
> Google OAuth 2.0 authentication is deferred to Milestone 4. In Milestone 2, requests are scoped to a deterministic development user (`00000000-0000-0000-0000-000000000001` / `dev@reachinbox.local`). Client-supplied user IDs in headers or request bodies are explicitly ignored to prevent insecure ownership spoofing.

---

### `POST /api/emails` — Create Draft Email
Creates a new email in `DRAFT` status.

- **Headers:**
  - `Content-Type: application/json`
  - `Idempotency-Key: <optional-string>`
- **Request Body:**
  ```json
  {
    "recipient": "prospect@example.com",
    "subject": "Follow-up regarding scheduled demo",
    "body": "Hi there, following up on our discussion yesterday."
  }
  ```
- **Validation Rules:**
  - `recipient`: Required, valid email format, max 320 chars.
  - `subject`: Required, non-empty, max 500 chars.
  - `body`: Required, non-empty, max 50,000 chars.
- **Success Response (New Record):** `HTTP 201 Created`
  ```json
  {
    "id": "e83f510a-4299-4a94-811c-22363b9f33df",
    "userId": "00000000-0000-0000-0000-000000000001",
    "recipient": "prospect@example.com",
    "subject": "Follow-up regarding scheduled demo",
    "body": "Hi there, following up on our discussion yesterday.",
    "status": "DRAFT",
    "scheduledTime": null,
    "sentAt": null,
    "idempotencyKey": "key-demo-123",
    "attemptCount": 0,
    "lastError": null,
    "createdAt": "2026-10-16T14:40:00.000Z",
    "updatedAt": "2026-10-16T14:40:00.000Z"
  }
  ```
- **Idempotency Replay (Identical Request + Same Key):** `HTTP 200 OK`
  - Header: `Idempotent-Replay: true`
  - Body: Returns the existing created record.
- **Idempotency Conflict (Same Key + Different Request Body):** `HTTP 409 Conflict`
  ```json
  {
    "error": {
      "message": "Idempotency key 'key-demo-123' was already used with a different request payload.",
      "status": 409
    }
  }
  ```

---

### `GET /api/emails` — List Paginated Emails
Retrieves paginated email records for the current user, ordered newest first.

- **Query Parameters:**
  - `page` (optional integer, default `1`)
  - `limit` (optional integer, default `10`, max `100`)
  - `status` (optional enum: `DRAFT`, `SCHEDULED`, `PROCESSING`, `SENT`, `FAILED`, `CANCELLED`)
- **Success Response:** `HTTP 200 OK`
  ```json
  {
    "data": [
      {
        "id": "e83f510a-4299-4a94-811c-22363b9f33df",
        "userId": "00000000-0000-0000-0000-000000000001",
        "recipient": "prospect@example.com",
        "subject": "Follow-up regarding scheduled demo",
        "body": "Hi there...",
        "status": "DRAFT",
        "scheduledTime": null,
        "sentAt": null,
        "idempotencyKey": "key-demo-123",
        "attemptCount": 0,
        "lastError": null,
        "createdAt": "2026-10-16T14:40:00.000Z",
        "updatedAt": "2026-10-16T14:40:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
  ```

---

### `GET /api/emails/:id` — Get Email by ID
- **Path Parameters:** `id` (must be a valid UUID)
- **Success Response:** `HTTP 200 OK` (returns single `EmailDto`)
- **Error Responses:**
  - `400 Bad Request`: If `:id` is not a valid UUID format.
  - `404 Not Found`: If email record does not exist.

---

### `PATCH /api/emails/:id` — Update Draft Email
Updates editable fields (`recipient`, `subject`, `body`) of a `DRAFT` email record.

- **Path Parameters:** `id` (UUID)
- **Request Body (At least one field required):**
  ```json
  {
    "subject": "Updated Subject Title",
    "body": "Updated body text."
  }
  ```
- **Draft Status Guard:**
  - If email status is **NOT** `DRAFT` (e.g. `SCHEDULED` or `SENT`): returns `HTTP 409 Conflict`.
  - Clients cannot directly update internal fields like `status`, `sentAt`, `attemptCount`, or `lastError`.
- **Success Response:** `HTTP 200 OK` (returns updated `EmailDto`)

---

### `DELETE /api/emails/:id` — Delete Draft Email
Deletes a draft email record.

- **Path Parameters:** `id` (UUID)
- **Draft Status Guard:**
  - If email status is **NOT** `DRAFT`: returns `HTTP 409 Conflict` (`Only emails in 'DRAFT' status can be deleted`).
  - Cannot delete scheduled, queued, or sent emails through this endpoint.
- **Success Response:** `HTTP 204 No Content`

---

## 6. Transactional Outbox Pattern

The transactional outbox pattern prevents dual-write inconsistencies when scheduling emails. Instead of updating the database and attempting to publish to Redis in separate uncoordinated steps, the email and its corresponding `OutboxEvent` are written inside a single PostgreSQL ACID transaction:

```typescript
// Located in apps/api/src/services/outbox.service.ts
export async function createScheduledEmailWithOutbox(input: ScheduleEmailOutboxInput) {
  return prisma.$transaction(async (tx) => {
    // 1. Create email in SCHEDULED state
    const email = await tx.email.create({ ... });

    // 2. Atomically create corresponding OutboxEvent row
    const outboxEvent = await tx.outboxEvent.create({
      data: {
        eventType: 'EMAIL_SCHEDULED',
        aggregateId: email.id,
        payload: { emailId: email.id, recipient: email.recipient, scheduledTime: email.scheduledTime },
        status: 'PENDING',
      }
    });

    return { email, outboxEvent };
  });
}
```

In Milestone 3, a dedicated background worker process will poll pending `OutboxEvent` records, reconcile them with Redis, and dispatch delayed jobs via BullMQ.

---

## 7. Running the Application

### Development Mode

Run both the Express API and Vite React frontend concurrently:
```powershell
npm run dev
```

Or run each service individually:

```powershell
# Run backend API with tsx file-watcher
npm run dev:api

# Run Vite frontend dev server
npm run dev:web
```

- **Frontend URL:** [http://localhost:5173](http://localhost:5173)
- **API Base URL:** [http://localhost:5000](http://localhost:5000)
- **Health Check URL:** [http://localhost:5000/health](http://localhost:5000/health)
- **Email API Endpoint:** [http://localhost:5000/api/emails](http://localhost:5000/api/emails)

---

## 8. Available npm Scripts

| Script | Purpose |
| :--- | :--- |
| `npm run dev` | Runs API (`5000`) and Web (`5173`) concurrently |
| `npm run dev:api` | Runs API in watch mode via `tsx` |
| `npm run dev:web` | Runs Vite frontend dev server |
| `npm run build` | Compiles `@reachinbox/shared`, `@reachinbox/api` (Prisma + TS), `@reachinbox/web`, and `@reachinbox/worker` |
| `npm run build:shared`| Compiles shared TypeScript contract types |
| `npm run build:api` | Generates Prisma Client & compiles Express backend TypeScript |
| `npm run build:web` | Compiles React + Vite production bundle |
| `npm run build:worker`| Compiles worker scaffold TypeScript |
| `npm test` | Runs the automated test suite in `apps/api` with Vitest (23 tests) |
| `npm run lint` | Runs TypeScript compilation checks across the monorepo |
| `npm run clean` | Removes `dist/` folders from all packages |
