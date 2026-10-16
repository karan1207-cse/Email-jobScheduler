import React from 'react';
import { CheckCircle2, Clock, Terminal, GitBranch } from 'lucide-react';

export const MilestoneOverview: React.FC = () => {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title-icon">
            <GitBranch size={18} />
          </div>
          <div>
            <h3 className="card-title">Milestone Roadmap</h3>
            <span className="card-subtitle">ReachInbox scheduler implementation progress</span>
          </div>
        </div>
      </div>

      <div className="roadmap-list">
        {/* Milestone 1 - Active */}
        <div className="roadmap-item active">
          <CheckCircle2 size={18} className="roadmap-check" />
          <div className="roadmap-text">
            <h4>Milestone 1 — Core Foundation</h4>
            <p>
              npm workspaces, @reachinbox/shared types, Express API with real DB/Redis health checks, 
              Vite + React frontend, Docker Compose configuration.
            </p>
          </div>
        </div>

        {/* Milestone 2 - Deferred */}
        <div className="roadmap-item">
          <Clock size={18} className="roadmap-pending" />
          <div className="roadmap-text">
            <h4>Milestone 2 — Queue & Background Worker</h4>
            <p>
              BullMQ delayed jobs scheduler, independent worker process, Ethereal SMTP email delivery, retry mechanism.
            </p>
          </div>
        </div>

        {/* Milestone 3 - Deferred */}
        <div className="roadmap-item">
          <Clock size={18} className="roadmap-pending" />
          <div className="roadmap-text">
            <h4>Milestone 3 — Scheduler Dashboard</h4>
            <p>
              Compose emails, schedule delivery times, monitor job statuses, execution history, metrics.
            </p>
          </div>
        </div>

        {/* Milestone 4 - Deferred */}
        <div className="roadmap-item">
          <Clock size={18} className="roadmap-pending" />
          <div className="roadmap-text">
            <h4>Milestone 4 — Auth, Slack & Search</h4>
            <p>
              Google OAuth 2.0 authentication, Slack rate-limit webhook notifications, Elasticsearch search index.
            </p>
          </div>
        </div>
      </div>

      <div style={{
        marginTop: '1.5rem',
        padding: '0.85rem 1rem',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        fontSize: '0.8rem',
        color: 'var(--text-secondary)'
      }}>
        <Terminal size={16} style={{ color: '#a5b4fc', flexShrink: 0 }} />
        <span>Run <code>npm run dev</code> in PowerShell to boot the full development stack.</span>
      </div>
    </div>
  );
};
