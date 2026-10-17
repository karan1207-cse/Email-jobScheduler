# Local Setup Guide

## Prerequisites

- Node.js 20+ and npm 10+
- Docker and Docker Compose (for Postgres, Redis, Elasticsearch)
- Git

## 1. Clone and install

```bash
git clone <repo-url>
cd Email-jobscheduler
npm install
```

## 2. Start infrastructure services

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5432`
- **Redis** on port `6379`
- **Elasticsearch 8.x** on port `9200` (single-node, no auth, dev mode)

Wait for Elasticsearch to be healthy (~30s):
```bash
docker compose ps
# elasticsearch should show "healthy"
```

## 3. Configure environment

```bash
cp .env.example .env
# Edit .env as needed — defaults work for local development
```

Key variables for Milestone 9:
```env
ELASTICSEARCH_URL=http://localhost:9200
EMAIL_QUEUE_NAME=email-jobs
# ADMIN_TOKEN=   # Leave unset in development; dashboard is localhost-only
```

## 4. Run database migrations

```bash
npm run prisma:migrate --workspace=apps/api
# Or: cd apps/api && npx prisma migrate deploy
```

## 5. Start the API server

```bash
npm run dev --workspace=apps/api
# API available at: http://localhost:5000
```

## 6. Start the worker

```bash
npm run dev --workspace=apps/worker
```

## 7. Start the frontend

```bash
npm run dev --workspace=apps/web
# Frontend available at: http://localhost:5173
```

## 8. Verify Elasticsearch

```bash
# Check ES health
curl http://localhost:9200/_cluster/health

# Check search status endpoint
curl http://localhost:5000/api/search/status

# Rebuild the index (localhost-only in dev, no token required)
curl -X POST http://localhost:5000/api/search/rebuild
```

## 9. Access the Queue Dashboard

Open your browser to:
```
http://localhost:5000/admin/queues
```

> **Note**: In development, this is accessible from `localhost` only.
> In production, set `ADMIN_TOKEN` and use `x-admin-token: <token>` header.

## 10. Run tests

```bash
npm test
# Runs Vitest across all workspaces
```

## Production Notes

1. Set `ADMIN_TOKEN` to a long random string to protect `/admin/queues` and `/api/search/rebuild`.
2. Configure Elasticsearch with TLS and authentication (`xpack.security.enabled=true`).
3. Set `NODE_ENV=production` and `SESSION_SECRET` to a strong random value.
4. Use a Redis-backed session store instead of the in-memory default.
5. Point `ELASTICSEARCH_URL` to your managed Elasticsearch cluster.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Elasticsearch not starting | Increase Docker memory limit to ≥2GB |
| `vm.max_map_count` error | Run `sysctl -w vm.max_map_count=262144` (Linux only) |
| Search returns `postgres_fallback` | Elasticsearch is not reachable; check `docker compose ps` |
| Dashboard returns 403 | In dev, access from `127.0.0.1`. In prod, set `ADMIN_TOKEN` |
| Tests fail with Prisma errors | Run `npm run prisma:generate --workspace=apps/api` |

## Full application in Docker Desktop (Windows)

The root `docker-compose.yml` starts PostgreSQL, Redis, Elasticsearch, the Express API, one BullMQ email worker, and the Vite frontend. The three app images use the root npm workspace/lockfile. The API runs `prisma migrate deploy` at startup. The API health check waits for PostgreSQL and Redis; the worker and frontend start after the API is healthy.

Prerequisites: Docker Desktop with its Linux engine running, WSL 2, and (when using Ubuntu) Docker Desktop WSL integration enabled for that distribution. From PowerShell in the repository:

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs -f
```

Visit `http://localhost:5173`; API health is `http://localhost:5000/health`. Stop with `docker compose down`. Named volumes preserve Postgres, Redis, and Elasticsearch data across that command. Avoid `docker compose down --volumes` unless data deletion is intended.

For local email testing, leave all SMTP variables blank. In development, the worker provisions an Ethereal test account and logs a web preview URL; Ethereal captures test messages instead of delivering to real recipients. Set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` together only when you intentionally configure an SMTP relay. Never commit `.env` or put secrets in `.env.example`. See the README's Docker section and `docs/ENVIRONMENT_SETUP.md` for variable descriptions.

This Compose setup runs in development mode. OAuth credentials are optional for the development-user fallback. It uses unauthenticated development Elasticsearch and a development-only session secret, so it is not a production deployment template.
