import React from 'react';
import { Mail, ShieldCheck } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="header">
      <div className="header-content">
        <a href="/" className="brand">
          <div className="brand-icon">
            <Mail size={22} />
          </div>
          <div>
            <div className="brand-title">
              ReachInbox
              <span className="brand-badge">Milestone 1</span>
            </div>
          </div>
        </a>

        <div className="header-meta">
          <div className="tag">
            <ShieldCheck size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle', color: '#10b981' }} />
            Monorepo Foundation
          </div>
        </div>
      </div>
    </header>
  );
};
