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
  const statusLabels: Record<string, string> = {
    DRAFT: 'Draft',
    SCHEDULED: 'Scheduled',
    PROCESSING: 'Processing',
    SENT: 'Sent',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
  };
  const messageText = email.body
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

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
          <span className={`badge-status-pill status-${email.status.toLowerCase()}`}>
            {statusLabels[email.status] ?? email.status}
          </span>
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
          <div className="body-main-text">
            {messageText.split('\n').map((line, idx) => (
              <p key={idx}>{line || '\u00A0'}</p>
            ))}
          </div>
        </div>

        {(email.previewUrl || email.lastError) && (
          <div className="delivery-details" aria-label="Delivery details">
            {email.previewUrl && (
              <a className="ethereal-preview-link" href={email.previewUrl} target="_blank" rel="noopener noreferrer">
                Open sent message in Ethereal ↗
              </a>
            )}
            {email.messageId && <span className="delivery-message-id">Message-ID: {email.messageId}</span>}
            {email.lastError && <span className="delivery-error">{email.lastError}</span>}
          </div>
        )}

        {email.attachments && email.attachments.length > 0 && (
          <div className="figma-attachments-section" aria-label="Email attachments">
            {email.attachments.map((attachment, index) => (
              <div className="attachment-card" key={`${attachment.filename}-${index}`}>
                <div className="attachment-thumb" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00A859" strokeWidth="2">
                    <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </div>
                <div className="attachment-info">
                  <span className="attachment-name">{attachment.filename}</span>
                  <span className="attachment-size">{(attachment.size / 1024).toFixed(0)} KB · {attachment.contentType}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
