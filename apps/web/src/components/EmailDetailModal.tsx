import React from 'react';
import type { EmailDto } from '@reachinbox/shared';

interface EmailDetailModalProps {
  email: EmailDto | null;
  onClose: () => void;
}

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({ email, onClose }) => {
  if (!email) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>Email Details</h3>
            <span className="modal-id">UUID: {email.id}</span>
          </div>
          <button className="btn-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Recipient</span>
              <span className="detail-val font-semibold">{email.recipient}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Status</span>
              <span className="detail-val">
                <span className={`status-badge badge-${email.status.toLowerCase()}`}>
                  {email.status}
                </span>
              </span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Scheduled For</span>
              <span className="detail-val">
                {email.scheduledTime ? new Date(email.scheduledTime).toLocaleString() : 'N/A'}
              </span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Sent At</span>
              <span className="detail-val">
                {email.sentAt ? new Date(email.sentAt).toLocaleString() : 'Not sent yet'}
              </span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Attempt Count</span>
              <span className="detail-val">{email.attemptCount}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Idempotency Key</span>
              <span className="detail-val text-mono">{email.idempotencyKey || 'None'}</span>
            </div>
          </div>

          <div className="detail-section">
            <span className="detail-label">Subject</span>
            <div className="detail-subject-box">{email.subject}</div>
          </div>

          <div className="detail-section">
            <span className="detail-label">Body Content</span>
            <pre className="detail-body-pre">{email.body}</pre>
          </div>

          {email.lastError && (
            <div className="detail-section">
              <span className="detail-label text-danger">Last Error / Ambiguous Quarantine Diagnostic</span>
              <div className="detail-error-box">{email.lastError}</div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
