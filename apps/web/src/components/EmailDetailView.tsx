import React, { useState } from 'react';
import type { EmailDto } from '@reachinbox/shared';
import { cancelScheduledEmail, deleteDraftEmail, type AuthUser } from '../api.js';

interface EmailDetailViewProps {
  email: EmailDto;
  onBack: () => void;
  currentUser: AuthUser;
  onEmailUpdated?: () => void;
}

export const EmailDetailView: React.FC<EmailDetailViewProps> = ({
  email,
  onBack,
  currentUser,
  onEmailUpdated,
}) => {
  const [isStarred, setIsStarred] = useState<boolean>(false);
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);

  const getSenderInitial = (str: string) => {
    return str ? str.charAt(0).toUpperCase() : 'A';
  };

  const formatFullDate = (dateString?: string | null) => {
    if (!dateString) return 'Recent';
    try {
      const d = new Date(dateString);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch {
      return dateString;
    }
  };

  const handleDeleteOrCancel = async () => {
    if (email.status === 'SCHEDULED') {
      if (!window.confirm('Cancel this scheduled delivery?')) return;
      setActionInProgress(true);
      try {
        await cancelScheduledEmail(email.id);
        if (onEmailUpdated) onEmailUpdated();
        onBack();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to cancel email');
      } finally {
        setActionInProgress(false);
      }
    } else if (email.status === 'DRAFT') {
      if (!window.confirm('Delete this draft?')) return;
      setActionInProgress(true);
      try {
        await deleteDraftEmail(email.id);
        if (onEmailUpdated) onEmailUpdated();
        onBack();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to delete email');
      } finally {
        setActionInProgress(false);
      }
    } else {
      alert(`Email is in ${email.status} state.`);
    }
  };

  // Extract clean recipient name
  const namePart = email.recipient.split('@')[0] || 'Recipient';
  const senderDisplayName = namePart.includes('.')
    ? namePart
        .split('.')
        .map((n) => n.charAt(0).toUpperCase() + n.slice(1))
        .join(' ')
    : namePart.charAt(0).toUpperCase() + namePart.slice(1);

  return (
    <div className="figma-email-detail-container">
      {/* Top Action Header */}
      <div className="figma-detail-top-bar">
        <div className="detail-top-left">
          <button type="button" className="figma-back-btn" onClick={onBack} title="Back to list" id="detail-back-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h2 className="detail-subject-title">
            {email.subject} <span className="detail-ref-id">| {email.id.slice(0, 14).toUpperCase()}</span>
          </h2>
        </div>

        <div className="detail-top-actions">
          <button
            type="button"
            className={`icon-action-btn ${isStarred ? 'starred' : ''}`}
            onClick={() => setIsStarred(!isStarred)}
            title="Star email"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={isStarred ? '#F59E0B' : 'none'} stroke={isStarred ? '#F59E0B' : '#6F767E'} strokeWidth="1.8">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>

          <button
            type="button"
            className="icon-action-btn"
            onClick={handleDeleteOrCancel}
            disabled={actionInProgress}
            title={email.status === 'SCHEDULED' ? 'Cancel Scheduled Send' : 'Delete'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F767E" strokeWidth="1.8">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

          <button type="button" className="icon-action-btn" title="Mark as unread">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F767E" strokeWidth="1.8">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </button>

          <div className="detail-user-avatar">
            {currentUser.picture ? (
              <img src={currentUser.picture} alt={currentUser.displayName} />
            ) : (
              <span>{getSenderInitial(currentUser.displayName || 'O')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Email Card */}
      <div className="figma-detail-card">
        {/* Sender Header */}
        <div className="figma-sender-row">
          <div className="sender-avatar-badge">
            {getSenderInitial(senderDisplayName)}
          </div>

          <div className="sender-meta">
            <div className="sender-name-group">
              <span className="sender-name">{senderDisplayName}</span>
              <span className="sender-email">&lt;{email.recipient}&gt;</span>
            </div>
            <span className="sender-to-me">to me ▾</span>
          </div>

          <div className="sender-date">
            <span>{formatFullDate(email.sentAt || email.scheduledTime || email.createdAt)}</span>
          </div>
        </div>

        {/* Email Body */}
        <div className="figma-detail-body">
          <p className="body-salutation">Hey {currentUser.displayName || 'Oliver'},</p>
          <p className="body-lead">You've just received a scheduled delivery update.</p>

          {/* Styled Callout Box (from Figma) */}
          <div className="figma-exclusive-callout">
            <div className="callout-lightning">⚡</div>
            <div className="callout-text">
              <strong>Extremely Exclusive — High-Performance Delivery Engine</strong>
              <span>
                To explore your active scheduled queues, monitor outbox pipelines, or adjust dispatch pacing, review your delivery status below.
              </span>
            </div>
          </div>

          {/* Render actual body content */}
          <div className="body-main-text">
            {email.body.split('\n').map((line, idx) => (
              <p key={idx}>{line || '\u00A0'}</p>
            ))}
          </div>

          <p className="body-signoff">
            Best regards,<br />
            <strong>ReachInbox Delivery Engine</strong>
          </p>

          <p className="body-ps">
            <em>P.S. Always remember that you can develop world class email scheduling with atomic leases! 🚀</em>
          </p>
        </div>

        {/* Attachments Section (matching Figma Image 2 Right) */}
        <div className="figma-attachments-section">
          <div className="attachment-card">
            <div className="attachment-thumb">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00A859" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <div className="attachment-info">
              <span className="attachment-name">Performance_Report.png</span>
              <span className="attachment-size">1.2 MB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
