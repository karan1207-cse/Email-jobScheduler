import React from 'react';
import type { HealthCheckResponse, ApiRootResponse } from '@reachinbox/shared';

interface HealthTelemetryProps {
  healthData: HealthCheckResponse | null;
  rootData: ApiRootResponse | null;
  httpStatus: number | null;
  loading: boolean;
  onRefresh: () => void;
  lastChecked: string | null;
  apiBaseUrl: string;
}

export const HealthTelemetry: React.FC<HealthTelemetryProps> = ({
  healthData,
  rootData,
  httpStatus,
  loading,
  onRefresh,
  lastChecked,
  apiBaseUrl,
}) => {
  const isHealthy = healthData?.status === 'healthy';

  return (
    <div className="telemetry-section">
      <div className="telemetry-header">
        <div>
          <h2>System Health &amp; Distributed Engine Telemetry</h2>
          <p className="section-desc">
            Direct real-time telemetry from <code className="code-pill">GET /health</code> and <code className="code-pill">GET /</code>
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading}>
          {loading ? 'Probing...' : 'Refresh Telemetry'}
        </button>
      </div>

      <div className="grid-cards">
        {/* API Backend Card */}
        <div className="card-glass">
          <div className="card-header">
            <span className="card-badge">REST API</span>
            <span className={`status-pill ${isHealthy ? 'healthy' : 'unhealthy'}`}>
              {isHealthy ? 'Online' : 'Degraded'}
            </span>
          </div>
          <h3>Express Backend</h3>
          <p className="card-subtext">Port: 5000 &bull; Uptime: {healthData ? `${healthData.uptime}s` : '---'}</p>
          <div className="card-meta-row">
            <span className="meta-label">HTTP Code</span>
            <span className="meta-val">{httpStatus ?? '---'}</span>
          </div>
        </div>

        {/* PostgreSQL Database Card */}
        <div className="card-glass">
          <div className="card-header">
            <span className="card-badge">Persistence</span>
            <span className={`status-pill ${healthData?.services.database.status === 'up' ? 'healthy' : 'unhealthy'}`}>
              {healthData?.services.database.status === 'up' ? 'Connected' : 'Unavailable'}
            </span>
          </div>
          <h3>PostgreSQL &amp; Prisma</h3>
          <p className="card-subtext">Version: PostgreSQL 16 &bull; Authoritative state</p>
          <div className="card-meta-row">
            <span className="meta-label">Latency</span>
            <span className="meta-val">
              {healthData?.services.database.latencyMs !== undefined
                ? `${healthData.services.database.latencyMs}ms`
                : '---'}
            </span>
          </div>
        </div>

        {/* Redis Message Broker Card */}
        <div className="card-glass">
          <div className="card-header">
            <span className="card-badge">Broker &amp; Limits</span>
            <span className={`status-pill ${healthData?.services.redis.status === 'up' ? 'healthy' : 'unhealthy'}`}>
              {healthData?.services.redis.status === 'up' ? 'Connected' : 'Unavailable'}
            </span>
          </div>
          <h3>Redis &amp; BullMQ</h3>
          <p className="card-subtext">Delayed queues &bull; Distributed rate limiting</p>
          <div className="card-meta-row">
            <span className="meta-label">Latency</span>
            <span className="meta-val">
              {healthData?.services.redis.latencyMs !== undefined
                ? `${healthData.services.redis.latencyMs}ms`
                : '---'}
            </span>
          </div>
        </div>

        {/* Worker & Environment Meta Card */}
        <div className="card-glass">
          <div className="card-header">
            <span className="card-badge">Engine Info</span>
            <span className="status-pill healthy">v1.0.0</span>
          </div>
          <h3>Node Runtime</h3>
          <p className="card-subtext">Configured API: {apiBaseUrl}</p>
          <div className="card-meta-row">
            <span className="meta-label">Last Polled</span>
            <span className="meta-val">{lastChecked || 'Never'}</span>
          </div>
        </div>
      </div>

      {rootData && (
        <div className="api-info-banner">
          <div className="api-info-text">
            <strong>{rootData.name}</strong> &bull; {rootData.description}
          </div>
          <span className="api-timestamp">Server Time: {new Date(rootData.timestamp).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};
