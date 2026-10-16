import React, { useState, useEffect, useCallback } from 'react';
import type { HealthCheckResponse, ApiRootResponse, EmailDto, PaginatedResponse } from '@reachinbox/shared';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

export const App: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [rootData, setRootData] = useState<ApiRootResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  // Email API Test Console State (Milestone 2)
  const [recipient, setRecipient] = useState<string>('demo@reachinbox.ai');
  const [subject, setSubject] = useState<string>('ReachInbox Milestone 2 Test');
  const [body, setBody] = useState<string>('Hello from the Email Scheduler API draft test.');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [apiConsoleLoading, setApiConsoleLoading] = useState<boolean>(false);
  const [apiConsoleResponse, setApiConsoleResponse] = useState<{
    status: number;
    headers: Record<string, string>;
    data: unknown;
  } | null>(null);
  const [apiConsoleError, setApiConsoleError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const rootPromise = fetch(`${API_BASE_URL}/`, {
        headers: { Accept: 'application/json' },
      }).then((res) => (res.ok ? res.json() : null)).catch(() => null);

      const healthRes = await fetch(`${API_BASE_URL}/health`, {
        headers: { Accept: 'application/json' },
      });

      setHttpStatus(healthRes.status);
      const healthJson = (await healthRes.json()) as HealthCheckResponse;
      setHealthData(healthJson);

      const rootJson = await rootPromise;
      if (rootJson) {
        setRootData(rootJson);
      }
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown network failure';
      setError(
        `Unable to connect to backend at ${API_BASE_URL}. Ensure the API server is running with 'npm run dev:api'. (${message})`
      );
      setHealthData(null);
      setRootData(null);
      setHttpStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiConsoleLoading(true);
    setApiConsoleError(null);
    setApiConsoleResponse(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      if (idempotencyKey.trim()) {
        headers['Idempotency-Key'] = idempotencyKey.trim();
      }

      const res = await fetch(`${API_BASE_URL}/api/emails`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ recipient, subject, body }),
      });

      const resHeaders: Record<string, string> = {};
      const replayHeader = res.headers.get('Idempotent-Replay');
      if (replayHeader) {
        resHeaders['Idempotent-Replay'] = replayHeader;
      }

      const json = await res.json();
      setApiConsoleResponse({
        status: res.status,
        headers: resHeaders,
        data: json,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setApiConsoleError(msg);
    } finally {
      setApiConsoleLoading(false);
    }
  };

  const handleFetchDrafts = async () => {
    setApiConsoleLoading(true);
    setApiConsoleError(null);
    setApiConsoleResponse(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/emails?page=1&limit=5`, {
        headers: { Accept: 'application/json' },
      });
      const json = (await res.json()) as PaginatedResponse<EmailDto>;
      setApiConsoleResponse({
        status: res.status,
        headers: {},
        data: json,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setApiConsoleError(msg);
    } finally {
      setApiConsoleLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const isConnected = !error && (healthData !== null || rootData !== null);
  const isHealthy = healthData?.status === 'healthy';

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="brand">
          <div className="logo-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </div>
          <div className="brand-text">
            <h1>ReachInbox</h1>
            <span>Email Job Scheduler &bull; Milestone 2</span>
          </div>
        </div>

        <div className="header-status">
          <div
            className={`status-pill ${
              loading ? 'loading' : isHealthy ? 'healthy' : isConnected ? 'healthy' : 'unhealthy'
            }`}
          >
            <div
              className={`status-indicator-dot ${
                loading ? 'loading' : isHealthy ? 'healthy' : isConnected ? 'healthy' : 'unhealthy'
              }`}
            />
            <span>
              {loading
                ? 'Connecting...'
                : isHealthy
                ? 'API Healthy (200 OK)'
                : isConnected
                ? `API Degraded (${httpStatus ?? 503})`
                : 'API Disconnected'}
            </span>
          </div>
          <button className="btn btn-secondary" onClick={fetchStatus} disabled={loading}>
            {loading ? 'Checking...' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="hero-tag">FOUNDATION &bull; MILESTONE 2: DATABASE &amp; EMAIL API</div>
        <h2>Distributed Delayed Email Engine</h2>
        <p>
          ReachInbox is a high-throughput, fault-tolerant email scheduling platform. Milestone 2 integrates
          Prisma ORM, relational email schema, draft management APIs, strict idempotency keys, and transactional
          outbox preparation.
        </p>
        <div className="hero-meta">
          <div className="meta-item">
            <span className="meta-label">Configured API Base</span>
            <span className="meta-val">{API_BASE_URL}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Architecture</span>
            <span className="meta-val">Monorepo (npm workspaces)</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Last Poll</span>
            <span className="meta-val">{lastChecked || 'Not checked yet'}</span>
          </div>
        </div>
      </section>

      {/* Live System Health Monitor */}
      <section className="health-panel">
        <div className="panel-header">
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Real-Time Dependency Health Telemetry</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Direct live response from <code style={{ color: '#a5b4fc' }}>GET /health</code> and{' '}
              <code style={{ color: '#a5b4fc' }}>GET /</code>
            </p>
          </div>
          <button className="btn" onClick={fetchStatus} disabled={loading}>
            {loading ? 'Probing services...' : 'Check Live Health'}
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '1rem 1.25rem',
              backgroundColor: 'var(--danger-bg)',
              border: '1px solid var(--danger-border)',
              borderRadius: '8px',
              color: '#fca5a5',
              fontSize: '0.9rem',
            }}
          >
            <strong>Backend Unreachable:</strong> {error}
          </div>
        )}

        {/* Live Metrics Grid */}
        <div className="grid-cards">
          <div className="card">
            <div className="card-header">
              <span className="meta-label">API Service</span>
              <span className={`status-pill ${isConnected ? 'healthy' : 'unhealthy'}`}>
                {isConnected ? 'Online' : 'Offline'}
              </span>
            </div>
            <h3>Express Backend</h3>
            <p>
              Port: 5000 &bull; Uptime: {healthData ? `${healthData.uptime}s` : 'N/A'}
            </p>
            <div className="card-footer">
              <span className="meta-label">HTTP Code</span>
              <span className="meta-val">{httpStatus ?? (error ? 'ERR' : '---')}</span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="meta-label">Relational Storage</span>
              <span
                className={`status-pill ${
                  healthData?.services.database.status === 'up' ? 'healthy' : 'unhealthy'
                }`}
              >
                {healthData?.services.database.status?.toUpperCase() || 'UNKNOWN'}
              </span>
            </div>
            <h3>PostgreSQL 16 &amp; Prisma</h3>
            <p>
              Connection pool status & query check.
              {healthData?.services.database.latencyMs !== undefined && (
                <span> Latency: {healthData.services.database.latencyMs}ms</span>
              )}
            </p>
            <div className="card-footer">
              <span className="meta-label">Query Verified</span>
              <span className="meta-val">
                {healthData?.services.database.status === 'up' ? 'SELECT 1 (OK)' : 'Pending Docker / DB'}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="meta-label">In-Memory Store</span>
              <span
                className={`status-pill ${
                  healthData?.services.redis.status === 'up' ? 'healthy' : 'unhealthy'
                }`}
              >
                {healthData?.services.redis.status?.toUpperCase() || 'UNKNOWN'}
              </span>
            </div>
            <h3>Redis 7 (AOF)</h3>
            <p>
              BullMQ queue engine persistence.
              {healthData?.services.redis.latencyMs !== undefined && (
                <span> Latency: {healthData.services.redis.latencyMs}ms</span>
              )}
            </p>
            <div className="card-footer">
              <span className="meta-label">Ping Verified</span>
              <span className="meta-val">
                {healthData?.services.redis.status === 'up' ? 'PONG (OK)' : 'Pending Docker / Redis'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Email Draft API Console (Milestone 2 Interactive Verification) */}
      <section className="health-panel">
        <div className="panel-header">
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Email Draft API Smoke Tester</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Test live calls to <code style={{ color: '#a5b4fc' }}>POST /api/emails</code> and{' '}
              <code style={{ color: '#a5b4fc' }}>GET /api/emails</code> with Idempotency Key validation.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={handleFetchDrafts} disabled={apiConsoleLoading}>
            List Drafts (GET /api/emails)
          </button>
        </div>

        <form onSubmit={handleCreateDraft} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div>
            <label className="meta-label" style={{ display: 'block', marginBottom: '0.35rem' }}>Recipient Email</label>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                backgroundColor: '#0a0d14',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontFamily: 'inherit',
                fontSize: '0.85rem',
              }}
            />
          </div>

          <div>
            <label className="meta-label" style={{ display: 'block', marginBottom: '0.35rem' }}>Subject Line</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                backgroundColor: '#0a0d14',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontFamily: 'inherit',
                fontSize: '0.85rem',
              }}
            />
          </div>

          <div>
            <label className="meta-label" style={{ display: 'block', marginBottom: '0.35rem' }}>Optional Idempotency-Key</label>
            <input
              type="text"
              placeholder="e.g. key-001"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                backgroundColor: '#0a0d14',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontFamily: 'inherit',
                fontSize: '0.85rem',
              }}
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label className="meta-label" style={{ display: 'block', marginBottom: '0.35rem' }}>Email Body</label>
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                backgroundColor: '#0a0d14',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontFamily: 'inherit',
                fontSize: '0.85rem',
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <button type="submit" className="btn" disabled={apiConsoleLoading}>
              {apiConsoleLoading ? 'Dispatching...' : 'Create Draft (POST)'}
            </button>
          </div>
        </form>

        {apiConsoleError && (
          <div
            style={{
              padding: '0.85rem 1rem',
              backgroundColor: 'var(--danger-bg)',
              border: '1px solid var(--danger-border)',
              borderRadius: '8px',
              color: '#fca5a5',
              fontSize: '0.85rem',
            }}
          >
            <strong>API Call Failed:</strong> {apiConsoleError}
          </div>
        )}

        {apiConsoleResponse && (
          <div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span className="meta-label">Response Code:</span>
              <span className={`status-pill ${apiConsoleResponse.status < 300 ? 'healthy' : 'unhealthy'}`}>
                HTTP {apiConsoleResponse.status}
              </span>
              {apiConsoleResponse.headers['Idempotent-Replay'] && (
                <span className="badge-tag done">Idempotent-Replay: true</span>
              )}
            </div>
            <pre className="code-block">{JSON.stringify(apiConsoleResponse.data, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Monorepo Architecture Overview */}
      <section>
        <h3 className="section-title">
          <span>Monorepo Architecture</span>
        </h3>
        <div className="grid-cards">
          <div className="card">
            <div className="card-header">
              <span className="meta-label">Package</span>
              <span className="badge-tag done">Verified</span>
            </div>
            <h3>@reachinbox/shared</h3>
            <p>Shared contract types: EmailDto, CreateEmailInput, UpdateEmailInput, PaginatedResponse, and Health status.</p>
            <div className="card-footer">
              <span className="meta-label">Location</span>
              <span className="meta-val">packages/shared</span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="meta-label">Service</span>
              <span className="badge-tag done">Verified</span>
            </div>
            <h3>@reachinbox/api</h3>
            <p>Express REST API with Prisma ORM, Email CRUD, Zod schema validation, Idempotency headers, and Outbox helper.</p>
            <div className="card-footer">
              <span className="meta-label">Location</span>
              <span className="meta-val">apps/api</span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="meta-label">Service</span>
              <span className="badge-tag done">Verified</span>
            </div>
            <h3>@reachinbox/web</h3>
            <p>React 18 + Vite frontend with real-time dependency telemetry and interactive Email Draft API tester.</p>
            <div className="card-footer">
              <span className="meta-label">Location</span>
              <span className="meta-val">apps/web</span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="meta-label">Worker Scaffold</span>
              <span className="badge-tag upcoming">Milestone 3</span>
            </div>
            <h3>@reachinbox/worker</h3>
            <p>Background worker placeholder initialized and configured for BullMQ email queue processing.</p>
            <div className="card-footer">
              <span className="meta-label">Location</span>
              <span className="meta-val">apps/worker</span>
            </div>
          </div>
        </div>
      </section>

      {/* Implementation Roadmap */}
      <section>
        <h3 className="section-title">
          <span>Project Roadmap Status</span>
        </h3>
        <div className="roadmap-list">
          <div className="roadmap-item active">
            <div>
              <strong>Milestone 1: ReachInbox Email Scheduler Foundation</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Monorepo setup, shared types, Express REST API, React Vite frontend, Docker Compose setup.
              </div>
            </div>
            <span className="badge-tag done">Completed</span>
          </div>

          <div className="roadmap-item active">
            <div>
              <strong>Milestone 2: Database Schema &amp; Email API</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Prisma ORM, PostgreSQL data models, Email CRUD, Idempotency key handling, transactional outbox pattern.
              </div>
            </div>
            <span className="badge-tag done">Current Milestone</span>
          </div>

          <div className="roadmap-item">
            <div>
              <strong>Milestone 3: Redis, BullMQ Queue &amp; Background Worker</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Job scheduling, BullMQ queue producer &amp; consumer, Ethereal SMTP test email dispatcher.
              </div>
            </div>
            <span className="badge-tag upcoming">Next Up</span>
          </div>

          <div className="roadmap-item">
            <div>
              <strong>Milestone 4: Google OAuth, Slack Notifications &amp; Dashboard UI</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                User authentication, Slack alerts for rate-limits, and scheduled/sent email management UI.
              </div>
            </div>
            <span className="badge-tag upcoming">Deferred</span>
          </div>
        </div>
      </section>
    </div>
  );
};
