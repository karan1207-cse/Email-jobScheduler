import React, { useState, useEffect, useCallback } from 'react';
import type { HealthCheckResponse, ApiRootResponse } from '@reachinbox/shared';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

export const App: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [rootData, setRootData] = useState<ApiRootResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch root info
      const rootPromise = fetch(`${API_BASE_URL}/`, {
        headers: { Accept: 'application/json' },
      }).then((res) => (res.ok ? res.json() : null)).catch(() => null);

      // 2. Fetch health status (returns 200 or 503 depending on dependency health)
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
            <span>Email Job Scheduler &bull; Milestone 1</span>
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
        <div className="hero-tag">FOUNDATION RELEASE &bull; MILESTONE 1</div>
        <h2>Distributed Delayed Email Engine</h2>
        <p>
          ReachInbox is a high-throughput, fault-tolerant email scheduling platform designed with Node.js,
          TypeScript, Redis, and PostgreSQL. Milestone 1 establishes the monorepo architecture, shared type
          contracts, and verified health telemetry.
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
            <h3>PostgreSQL 16</h3>
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

        {/* Live Payload Preview */}
        {healthData && (
          <div>
            <span className="meta-label" style={{ display: 'block', marginBottom: '0.4rem' }}>
              Raw Response Payload (GET /health)
            </span>
            <pre className="code-block">{JSON.stringify(healthData, null, 2)}</pre>
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
            <p>Type contracts for health responses, API schemas, and service statuses used across API and Web.</p>
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
            <p>Express 4 + TypeScript REST API featuring graceful shutdown, CORS security, and health checking.</p>
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
            <p>React 18 + Vite + TypeScript frontend with live backend connectivity testing and design system.</p>
            <div className="card-footer">
              <span className="meta-label">Location</span>
              <span className="meta-val">apps/web</span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="meta-label">Worker Scaffold</span>
              <span className="badge-tag upcoming">Milestone 2</span>
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
            <span className="badge-tag done">Current Milestone</span>
          </div>

          <div className="roadmap-item">
            <div>
              <strong>Milestone 2: Redis, BullMQ Queue & Worker Engine</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Job scheduling, BullMQ queue producer & consumer, Ethereal SMTP test email dispatcher.
              </div>
            </div>
            <span className="badge-tag upcoming">Next Up</span>
          </div>

          <div className="roadmap-item">
            <div>
              <strong>Milestone 3: PostgreSQL Data Persistence & Job History</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Database migrations, email status tracking, failure retries, and job audit trails.
              </div>
            </div>
            <span className="badge-tag upcoming">Deferred</span>
          </div>

          <div className="roadmap-item">
            <div>
              <strong>Milestone 4: Google OAuth, Slack Notifications & Dashboard UI</strong>
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
