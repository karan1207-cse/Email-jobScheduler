import React, { useState } from 'react';
import type { EmailDto } from '@reachinbox/shared';

interface EmailListViewProps {
  emails: EmailDto[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  onSelectEmail: (email: EmailDto) => void;
  activeTab: 'scheduled' | 'sent';
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}

export const EmailListView: React.FC<EmailListViewProps> = ({
  emails,
  loading,
  searchQuery,
  onSearchChange,
  onRefresh,
  onSelectEmail,
  activeTab,
  statusFilter,
  onStatusFilterChange,
}) => {
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const statusLabels: Record<string, string> = {
    DRAFT: 'Draft',
    SCHEDULED: 'Scheduled',
    PROCESSING: 'Processing',
    SENT: 'Sent',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
  };

  const toggleStar = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatScheduleBadge = (dateString?: string | null) => {
    if (!dateString) return 'Upcoming';
    try {
      const date = new Date(dateString);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const day = days[date.getDay()];
      const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      return `${day} ${timeStr}`;
    } catch {
      return 'Scheduled';
    }
  };

  // Extract clean display name from recipient if possible
  const getRecipientDisplayName = (emailAddress: string) => {
    if (!emailAddress) return 'Recipient';
    const namePart = emailAddress.split('@')[0] || '';
    if (namePart.includes('.')) {
      return namePart
        .split('.')
        .map((n) => n.charAt(0).toUpperCase() + n.slice(1))
        .join(' ');
    }
    return namePart.charAt(0).toUpperCase() + namePart.slice(1);
  };

  return (
    <div className="figma-email-list-view">
      {/* Top Search Bar */}
      <div className="figma-search-bar">
        <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="figma-search-input"
          placeholder="Search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          id="email-search-input"
        />
        <div className="search-actions">
          <button
            type="button"
            className="icon-btn"
            title="Filter emails"
            aria-label="Filter emails"
            aria-expanded={filterOpen}
            aria-haspopup="menu"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
          {filterOpen && (
            <div className="email-filter-menu" role="menu" aria-label="Email status filter">
              <span className="email-filter-heading">Filter by status</span>
              {[
                ['CURRENT', `Current view (${activeTab})`],
                ['ALL', 'All statuses'],
                ['DRAFT', 'Draft'],
                ['SCHEDULED', 'Scheduled'],
                ['PROCESSING', 'Processing'],
                ['SENT', 'Sent'],
                ['FAILED', 'Failed'],
                ['CANCELLED', 'Cancelled'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={statusFilter === value}
                  className={`email-filter-option${statusFilter === value ? ' selected' : ''}`}
                  onClick={() => {
                    onStatusFilterChange(value);
                    setFilterOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="icon-btn" onClick={onRefresh} title="Refresh emails" id="refresh-emails-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Email Rows List */}
      <div className="figma-email-table">
        {loading ? (
          <div className="figma-list-empty">
            <div className="figma-spinner"></div>
            <span>Loading emails...</span>
          </div>
        ) : emails.length === 0 ? (
          <div className="figma-list-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9A9FA5" strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <p>No {activeTab} emails found.</p>
            {searchQuery && <span className="empty-sub">Try searching with different keywords.</span>}
          </div>
        ) : (
          emails.map((email) => {
            const isStarred = starredIds.has(email.id);
            const recipientName = getRecipientDisplayName(email.recipient);

            return (
              <div
                key={email.id}
                className="figma-email-row"
                onClick={() => onSelectEmail(email)}
              >
                {/* Column 1: Recipient */}
                <div className="email-row-recipient">
                  <span>To: {recipientName}</span>
                </div>

                {/* Column 2: Badge + Subject + Snippet */}
                <div className="email-row-content">
                  {email.status === 'SCHEDULED' ? (
                    <span className="badge-scheduled-pill">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {formatScheduleBadge(email.scheduledTime)}
                    </span>
                  ) : (
                    <span className={`badge-status-pill status-${email.status.toLowerCase()}`}>
                      {statusLabels[email.status] ?? email.status}
                    </span>
                  )}

                  <span className="email-row-subject">
                    {email.subject}
                    {email.status === 'SCHEDULED' ? ' - Scheduled' : ''}
                  </span>

                  <span className="email-row-snippet">
                    - {email.body ? email.body.replace(/<[^>]+>/g, '').slice(0, 100) : ''}...
                  </span>
                </div>

                {/* Column 3: Star Action */}
                <button
                  type="button"
                  className={`star-btn ${isStarred ? 'starred' : ''}`}
                  onClick={(e) => toggleStar(e, email.id)}
                  title={isStarred ? 'Unstar' : 'Star'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={isStarred ? '#F59E0B' : 'none'} stroke={isStarred ? '#F59E0B' : '#9A9FA5'} strokeWidth="1.8">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
