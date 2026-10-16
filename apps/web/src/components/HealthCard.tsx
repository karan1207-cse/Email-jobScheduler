import React from 'react';
import { 
  Activity, 
  Database, 
  Layers, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Clock,
  Radio
} from 'lucide-react';
import type { HealthCheckResponse } from '@reachinbox/shared';
import { API_BASE_URL } from '../api.js';

interface HealthCardProps {
  health: HealthCheckResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export const HealthCard: React.FC<HealthCardProps> = ({
  health,
  loading,
  error,
  onRefresh,
}) => {
  const isHealthy = health?.status === 'healthy';
  const isDegraded = health?.status === 'unhealthy';
  const isDisconnected = Boolean(error);

  let statusClass = 'status-checking';
  let statusText = 'Checking...';

  if (loading && !health) {
    statusClass = 'status-checking';
    statusText = 'Connecting...';
  } else if (isDisconnected) {
    statusClass = 'status-unhealthy';
    statusText = 'API Disconnected';
  } else if (isHealthy) {
    statusClass = 'status-healthy';
    statusText = 'System Healthy';
  } else if (isDegraded) {
    statusClass = 'status-unhealthy';
    statusText = 'Dependencies Degraded';
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-icon">
            <Activity size={18} />
          </div>
          <div>
            <h3 className="card-title">Live Infrastructure Health</h3>
            <span className="card-subtitle">Real-time PostgreSQL and Redis connectivity</span>
          </div>
        </div>

        <div className={`status-pill ${statusClass}`}>
          <span className="pulse-dot" />
          <span>{statusText}</span>
        </div>
      </div>

      {/* Services List */}
      <div className="services-list">
        {/* PostgreSQL Service */}
        <div className="service-item">
          <div className="service-info">
            <div className="service-icon" style={{ color: '#38bdf8' }}>
              <Database size={20} />
            </div>
            <div>
              <div className="service-name">PostgreSQL Database</div>
              <div className="service-desc">Relational storage for email jobs & state</div>
            </div>
          </div>

          <div className="service-status-area">
            {health?.services.database.latencyMs !== undefined && (
              <span className="latency-badge">{health.services.database.latencyMs}ms</span>
            )}

            {health?.services.database.status === 'up' ? (
              <span style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: 600 }}>
                <CheckCircle2 size={16} /> Online
              </span>
            ) : health?.services.database.status === 'down' ? (
              <span style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: 600 }}>
                <XCircle size={16} /> Offline
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}>
                <Radio size={14} className="animate-spin" /> Pending
              </span>
            )}
          </div>
        </div>

        {/* Redis Service */}
        <div className="service-item">
          <div className="service-info">
            <div className="service-icon" style={{ color: '#f87171' }}>
              <Layers size={20} />
            </div>
            <div>
              <div className="service-name">Redis & BullMQ Broker</div>
              <div className="service-desc">Queue coordinator & delayed job scheduler</div>
            </div>
          </div>

          <div className="service-status-area">
            {health?.services.redis.latencyMs !== undefined && (
              <span className="latency-badge">{health.services.redis.latencyMs}ms</span>
            )}

            {health?.services.redis.status === 'up' ? (
              <span style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: 600 }}>
                <CheckCircle2 size={16} /> Online
              </span>
            ) : health?.services.redis.status === 'down' ? (
              <span style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: 600 }}>
                <XCircle size={16} /> Offline
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}>
                <Radio size={14} className="animate-spin" /> Pending
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Error or Alert Box */}
      {error && (
        <div style={{
          background: 'var(--color-danger-bg)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: '0.85rem 1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: '0.85rem',
          color: '#fca5a5'
        }}>
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Backend Connection Failed:</strong> {error}
            <div style={{ fontSize: '0.75rem', color: '#fecaca', marginTop: '2px' }}>
              Verify that the API server is running on <code>{API_BASE_URL}</code>.
            </div>
          </div>
        </div>
      )}

      {/* Extra Info when connected */}
      {health && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1.25rem',
          background: 'rgba(255, 255, 255, 0.02)',
          padding: '0.85rem 1rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={14} style={{ color: '#818cf8' }} />
            <span>Uptime: <strong style={{ color: 'var(--text-primary)' }}>{health.uptime}s</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Last checked: <strong style={{ color: 'var(--text-primary)' }}>{new Date(health.timestamp).toLocaleTimeString()}</strong></span>
          </div>
        </div>
      )}

      {/* Health Card Controls */}
      <div className="health-controls">
        <div className="api-endpoint-badge">
          <span>Target API:</span>
          <span className="api-url">{API_BASE_URL}</span>
        </div>

        <button 
          className="button-primary"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Testing...' : 'Check Status Now'}
        </button>
      </div>
    </div>
  );
};
