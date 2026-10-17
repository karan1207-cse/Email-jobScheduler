import React, { useState } from 'react';
import type { AuthUser } from '../api.js';

export type DashboardTab = 'scheduled' | 'sent' | 'slack' | 'health';

interface SidebarProps {
  currentTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  onComposeClick: () => void;
  user: AuthUser;
  onLogout: () => void;
  scheduledCount: number;
  sentCount: number;
  isComposeActive: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  onComposeClick,
  user,
  onLogout,
  scheduledCount,
  sentCount,
  isComposeActive,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  // Avatar initials or default
  const initials = user.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U';

  return (
    <aside className="figma-sidebar">
      {/* Brand Logo */}
      <div className="figma-brand">
        <span className="figma-logo-text">ONB</span>
      </div>

      {/* User Profile Card / Header with dropdown */}
      <div className="figma-user-wrapper">
        <button
          type="button"
          className="figma-user-card"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          id="user-profile-menu-btn"
        >
          <div className="figma-user-avatar">
            {user.picture ? (
              <img src={user.picture} alt={user.displayName} />
            ) : (
              <div className="avatar-placeholder">{initials}</div>
            )}
          </div>
          <div className="figma-user-info">
            <span className="figma-user-name">{user.displayName || 'Oliver Brown'}</span>
            <span className="figma-user-email">{user.email || 'oliver.brown@domain.io'}</span>
          </div>
          <svg
            className={`figma-chevron ${dropdownOpen ? 'open' : ''}`}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="figma-user-dropdown">
            <div className="dropdown-header">
              <span className="dropdown-user-title">{user.displayName}</span>
              <span className="dropdown-user-sub">{user.email}</span>
            </div>
            <div className="dropdown-divider"></div>
            <a
              href="/admin/queues"
              target="_blank"
              rel="noreferrer"
              className="dropdown-item"
              onClick={() => setDropdownOpen(false)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              BullMQ Dashboard
            </a>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => {
                setDropdownOpen(false);
                onTabChange('slack');
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z" />
                <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
                <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z" />
                <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z" />
              </svg>
              Slack Notifications
            </button>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => {
                setDropdownOpen(false);
                onTabChange('health');
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              System Telemetry
            </button>
            <div className="dropdown-divider"></div>
            <button
              type="button"
              className="dropdown-item text-danger"
              onClick={() => {
                setDropdownOpen(false);
                onLogout();
              }}
              id="logout-btn"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Logout
            </button>
          </div>
        )}
      </div>

      {/* Compose Button */}
      <button
        type="button"
        className={`figma-compose-btn ${isComposeActive ? 'active' : ''}`}
        onClick={onComposeClick}
        id="sidebar-compose-btn"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>Compose</span>
      </button>

      {/* CORE Navigation section */}
      <div className="figma-nav-section">
        <span className="figma-nav-label">CORE</span>
        <nav className="figma-nav-list">
          <button
            type="button"
            className={`figma-nav-item ${!isComposeActive && currentTab === 'scheduled' ? 'active' : ''}`}
            onClick={() => onTabChange('scheduled')}
            id="nav-scheduled-tab"
          >
            <div className="nav-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Scheduled</span>
            </div>
            <span className="figma-badge">{scheduledCount}</span>
          </button>

          <button
            type="button"
            className={`figma-nav-item ${!isComposeActive && currentTab === 'sent' ? 'active' : ''}`}
            onClick={() => onTabChange('sent')}
            id="nav-sent-tab"
          >
            <div className="nav-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              <span>Sent</span>
            </div>
            <span className="figma-badge">{sentCount}</span>
          </button>
        </nav>
      </div>
    </aside>
  );
};
