import React from 'react';
import type { AuthUser } from '../api.js';
import { API_BASE_URL } from '../api.js';

export type ActiveTab = 'overview' | 'scheduled' | 'sent' | 'drafts' | 'compose';

interface NavbarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  user: AuthUser | null;
  onLogout: () => void;
  isHealthy: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  user,
  onLogout,
  isHealthy,
}) => {
  const handleGoogleSignIn = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  return (
    <header className="navbar">
      <div className="nav-brand" onClick={() => onTabChange('overview')} role="button" tabIndex={0}>
        <div className="nav-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </div>
        <div className="nav-brand-text">
          <h2>ReachInbox</h2>
          <span className="nav-brand-tag">Email Engine</span>
        </div>
      </div>

      <nav className="nav-tabs">
        <button
          className={`nav-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => onTabChange('overview')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          Overview
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'scheduled' ? 'active' : ''}`}
          onClick={() => onTabChange('scheduled')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Scheduled
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'sent' ? 'active' : ''}`}
          onClick={() => onTabChange('sent')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          Sent
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'drafts' ? 'active' : ''}`}
          onClick={() => onTabChange('drafts')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Drafts &amp; Queue
        </button>

        <button
          className={`nav-tab-btn nav-tab-compose ${activeTab === 'compose' ? 'active' : ''}`}
          onClick={() => onTabChange('compose')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Campaign
        </button>
      </nav>

      <div className="nav-user-section">
        {/* API Health Dot */}
        <div className={`nav-health-indicator ${isHealthy ? 'healthy' : 'degraded'}`} title={isHealthy ? 'System Healthy' : 'System Degraded'} />

        {user ? (
          <div className="user-profile-card">
            {user.picture ? (
              <img src={user.picture} alt={user.displayName} className="user-avatar-img" />
            ) : (
              <div className="user-avatar-fallback">
                {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <div className="user-profile-info">
              <span className="user-name">{user.displayName || user.email}</span>
              <span className="user-email">{user.email}</span>
            </div>
            <button className="btn-logout" onClick={onLogout} title="Sign Out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        ) : (
          <button className="btn-google-signin" onClick={handleGoogleSignIn}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Sign in with Google
          </button>
        )}
      </div>
    </header>
  );
};
