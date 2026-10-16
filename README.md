# ReachInbox — Full-Stack Email Job Scheduler

Production-grade, distributed email scheduling platform foundation built with React, Vite, Node.js, Express, TypeScript, PostgreSQL, and Redis.

---

## 1. Project Overview

ReachInbox is an enterprise-ready delayed email delivery platform. The system is designed to handle high-throughput email scheduling with granular concurrency control, retry policies, delivery auditing, and fault tolerance.

### Current Implementation Status (Milestone 1)
- **Status:** **Milestone 1 — System Foundation (COMPLETED)**
- **Scope:** Monorepo architecture, npm workspaces, strict TypeScript configuration, shared contracts package, Express REST API with real PostgreSQL & Redis health probes, React + Vite frontend with live telemetry dashboard, and Docker Compose development services.

> [!NOTE]
> **Features Deliberately Deferred to Later Milestones:**
> - **Milestone 2:** BullMQ queue engine, delayed email dispatcher, worker process, Ethereal test SMTP integration.
> - **Milestone 3:** PostgreSQL schema migrations, job history, and failure retry policies.
> - **Milestone 4:** Google OAuth 2.0 authentication, Slack rate-limit webhook notifications, Elasticsearch index, and full analytics dashboard.

---

## 2. Technology Stack

- **Monorepo:** npm workspaces
- **Backend API:** Node.js (v20+ / v24+), Express 4, TypeScript, pg (PostgreSQL client pool), ioredis
- **Frontend App:** React 18, Vite 6, TypeScript, Lucide Icons, Modern Vanilla CSS Design System
- **Database:** PostgreSQL 16 (Alpine)
- **In-Memory Store & Queue Broker:** Redis 7 (Alpine with Append-Only File `AOF` persistence)
- **Scaffold Worker:** Dedicated worker package for future BullMQ background job processing
- **Testing:** Vitest, Supertest

---

## 3. Repository Structure

```text
reachinbox-email-scheduler/
├── apps/
│   ├── api/                     # Express + TypeScript REST API
│   │   ├── src/
│   │   │   ├── __tests__/       # Vitest route & health probe test suite
│   │   │   ├── db/              # PostgreSQL pool & SELECT 1 health probe
│   │   │   ├── middleware/      # Centralized error & 404 handlers
│   │   │   ├── redis/           # ioredis client & PING health probe
│   │   │   ├── routes/          # Root (/) and Health (/health) routes
│   │   │   ├── app.ts           # Express application factory (CORS, JSON, routes)
│   │   │   ├── config.ts        # Environment loading & validation
│   │   │   └── index.ts         # Server boot & graceful shutdown
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/                     # React + Vite + TypeScript Frontend
│   │   ├── src/
│   │   │   ├── components/      # Header, HealthCard, MilestoneOverview, Footer
│   │   │   ├── api.ts           # Real backend fetch client
│   │   │   ├── App.tsx          # Real-time health dashboard & telemetry
│   │   │   ├── index.css        # Modern design system & CSS tokens
│   │   │   └── main.tsx         # React DOM root entrypoint
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── worker/                  # Background Worker Scaffold (Milestone 2)
│       ├── src/
│       │   └── index.ts         # Worker scaffold placeholder
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/                  # Shared TypeScript Contracts & Types
│       ├── src/
│       │   └── index.ts         # HealthCheckResponse, ApiRootResponse, SystemStatus
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

## 4. Prerequisites

- **Operating System:** Windows 10/11, macOS, or Linux (Windows PowerShell compatible)
- **Node.js:** `>= 20.0.0` (Tested on `v24.19.0`)
- **npm:** `>= 10.0.0` (Tested on `11.17.0`)
- **Docker & Docker Compose:** Optional for running local PostgreSQL & Redis containers (Docker Desktop for Windows)

---

## 5. Getting Started (Windows PowerShell)

### Step 1: Clone and Configure Environment Variables
Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Verify your `.env` configuration:
```env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:5173

# PostgreSQL
POSTGRES_USER=reachinbox
POSTGRES_PASSWORD=reachinbox_secret
POSTGRES_DB=reachinbox_db
POSTGRES_PORT=5432
DATABASE_URL=postgresql://reachinbox:reachinbox_secret@localhost:5432/reachinbox_db

# Redis
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# Frontend
VITE_API_URL=http://localhost:5000
```

### Step 2: Install Workspace Dependencies
Generate or restore node_modules across all workspaces:

```powershell
npm install
```

### Step 3: Start PostgreSQL and Redis (Docker Compose)
If Docker Desktop is installed and running:

```powershell
# Start database and Redis containers in the background
docker compose up -d

# Verify container status and health
docker compose ps
```

To stop the containers:
```powershell
docker compose down
```

### Step 4: Verify Database and Redis Health Directly

```powershell
# PostgreSQL connectivity probe
docker compose exec postgres pg_isready -U reachinbox -d reachinbox_db

# Redis connectivity probe
docker compose exec redis redis-cli ping
```

---

## 6. Running the Application

### Development Mode

Run both the Express API and Vite React frontend concurrently:
```powershell
npm run dev
```

Or run each service individually in separate PowerShell windows:

```powershell
# Run backend API with tsx file-watcher
npm run dev:api

# Run Vite frontend dev server
npm run dev:web
```

- **Frontend URL:** [http://localhost:5173](http://localhost:5173)
- **API Base URL:** [http://localhost:5000](http://localhost:5000)
- **API Health Check:** [http://localhost:5000/health](http://localhost:5000/health)

---

## 7. Available npm Scripts

| Script | Purpose |
| :--- | :--- |
| `npm run dev` | Runs API (`5000`) and Web (`5173`) concurrently |
| `npm run dev:api` | Runs API in watch mode via `tsx` |
| `npm run dev:web` | Runs Vite frontend dev server |
| `npm run build` | Compiles `@reachinbox/shared`, `@reachinbox/api`, `@reachinbox/web`, and `@reachinbox/worker` |
| `npm run build:shared`| Compiles shared TypeScript contract types |
| `npm run build:api` | Compiles Express backend TypeScript to `apps/api/dist` |
| `npm run build:web` | Compiles React + Vite production bundle to `apps/web/dist` |
| `npm run build:worker`| Compiles worker scaffold TypeScript to `apps/worker/dist` |
| `npm test` | Runs the automated test suite in `apps/api` with Vitest |
| `npm run lint` | Runs TypeScript compilation and type checks across the monorepo |
| `npm run clean` | Removes `dist/` folders from all packages |

---

## 8. API Health Contract Specification

The API implements a dual-check health probe returning standard HTTP status codes and strict JSON bodies matching `@reachinbox/shared`:

### `GET /` — API Identification
- **Status:** `200 OK`
- **Response:**
  ```json
  {
    "name": "ReachInbox Email Job Scheduler API",
    "version": "1.0.0",
    "status": "online",
    "description": "Production-ready delayed email scheduling platform API",
    "timestamp": "2026-10-16T14:31:54.862Z"
  }
  ```

### `GET /health` — Dependency Probes
- **Status:** 
  - `200 OK`: When **both** PostgreSQL and Redis connections succeed.
  - `503 Service Unavailable`: When **either** or **both** dependencies fail.
- **Example Response (Healthy):**
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-10-16T14:32:00.000Z",
    "uptime": 128,
    "services": {
      "database": {
        "status": "up",
        "latencyMs": 4
      },
      "redis": {
        "status": "up",
        "latencyMs": 1
      }
    }
  }
  ```
- **Example Response (Degraded / Unhealthy):**
  ```json
  {
    "status": "unhealthy",
    "timestamp": "2026-10-16T14:32:16.958Z",
    "uptime": 27,
    "services": {
      "database": {
        "status": "down",
        "message": "Database service unreachable or query failed."
      },
      "redis": {
        "status": "down",
        "message": "Redis service unreachable or ping failed."
      }
    }
  }
  ```
> [!IMPORTANT]
> Public responses never expose internal stack traces, passwords, or connection strings.

---

## 9. Troubleshooting Common Errors

### 1. `EADDRINUSE: address already in use :::5000`
Another process is already bound to port 5000.
To identify and terminate it on Windows PowerShell:
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 5000).OwningProcess | Stop-Process -Force
```
Alternatively, configure a different port (e.g. `PORT=5001`) in `.env` and update `VITE_API_URL=http://localhost:5001`.

### 2. `Docker is not recognized as an internal or external command`
Docker Desktop is either not installed or its binary is not present in your system `PATH`.
- Ensure Docker Desktop is installed and started.
- Add `C:\Program Files\Docker\Docker\resources\bin` to your Windows Environment Variables `PATH`.
- If Docker is unavailable, the API correctly handles the degraded state by returning `HTTP 503` with `{ status: "unhealthy", services: { database: { status: "down" }, redis: { status: "down" } } }`.

### 3. Frontend Displays "API Disconnected"
- Ensure `npm run dev:api` is running on port 5000.
- Verify `VITE_API_URL` in `.env` matches the backend host and port.
- Check browser dev tools console for CORS or network reachability errors.
