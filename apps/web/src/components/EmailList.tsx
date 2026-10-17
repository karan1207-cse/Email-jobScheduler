import React, { useState, useEffect, useCallback } from 'react';
import type { EmailDto, PaginatedResponse } from '@reachinbox/shared';
import { listEmails, cancelScheduledEmail, deleteDraftEmail } from '../api.js';

interface EmailListProps {
  initialStatus?: string;
  title: string;
  description: string;
  onSelectEmail?: (email: EmailDto) => void;
}

export const EmailList: React.FC<EmailListProps> = ({
  initialStatus = 'ALL',
  title,
  description,
  onSelectEmail,
}) => {
  const [emails, setEmails] = useState<EmailDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: PaginatedResponse<EmailDto> = await listEmails(page, 10, statusFilter);
      setEmails(res.data);
      setTotalPages(res.pagination.totalPages);
      setTotalCount(res.pagination.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch emails.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  // Keep countdown updated every 10 seconds
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(timer);
  }, []);

  const handleCancel = async (id: string) => {
    if (!window.confirm('Are you sure you want to cancel this scheduled email?')) {
      return;
    }
    setActionInProgressId(id);
    try {
      const updated = await cancelScheduledEmail(id);
      setEmails((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not cancel email.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this draft?')) {
      return;
    }
    setActionInProgressId(id);
    try {
      await deleteDraftEmail(id);
      setEmails((prev) => prev.filter((e) => e.id !== id));
      setTotalCount((c) => Math.max(0, c - 1));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete draft.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const formatCountdown = (scheduledTimeStr: string | null): string => {
    if (!scheduledTimeStr) return 'Not scheduled';
    const diff = new Date(scheduledTimeStr).getTime() - Date.now();
    if (diff <= 0) return 'Due now / In dispatch';

    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    const days = Math.floor(hours / 24);

    if (days > 0) return `In ${days}d ${hours % 24}h`;
    if (hours > 0) return `In ${hours}h ${remMins}m`;
    return `In ${mins}m`;
  };

  const getStatusBadge = (status: EmailDto['status']) => {
    switch (status) {
      case 'SCHEDULED':
        return <span className="status-badge badge-scheduled">SCHEDULED</span>;
      case 'SENT':
        return <span className="status-badge badge-sent">SENT</span>;
      case 'PROCESSING':
        return <span className="status-badge badge-processing">PROCESSING</span>;
      case 'FAILED':
        return <span className="status-badge badge-failed">FAILED</span>;
      case 'CANCELLED':
        return <span className="status-badge badge-cancelled">CANCELLED</span>;
      case 'DRAFT':
      default:
        return <span className="status-badge badge-draft">DRAFT</span>;
    }
  };

  return (
    <div className="table-card">
      <div className="table-header-row">
        <div>
          <h2>{title}</h2>
          <p className="section-desc">{description}</p>
        </div>

        <div className="table-actions-row">
          {/* Status filter dropdown */}
          <div className="filter-wrapper">
            <select
              className="select-field"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Statuses</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="SENT">Sent</option>
              <option value="PROCESSING">Processing</option>
              <option value="FAILED">Failed / Quarantined</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="DRAFT">Drafts</option>
            </select>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={fetchEmails} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-box alert-danger">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="table-loading-state">
          <div className="spinner-sm" />
          <span>Loading email records...</span>
        </div>
      ) : emails.length === 0 ? (
        <div className="table-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
          <h3>No emails found</h3>
          <p>
            {statusFilter === 'ALL'
              ? 'No email records exist in your account. Click "New Campaign" to schedule emails.'
              : `No emails currently match the status "${statusFilter}".`}
          </p>
        </div>
      ) : (
        <div className="responsive-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Scheduled Delivery</th>
                <th>Sent / Details</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => (
                <tr key={email.id} className="table-row-hover">
                  <td className="cell-recipient">
                    <span className="font-semibold">{email.recipient}</span>
                  </td>
                  <td className="cell-subject">
                    <span className="subject-text" title={email.subject}>
                      {email.subject}
                    </span>
                  </td>
                  <td>{getStatusBadge(email.status)}</td>
                  <td>
                    {email.scheduledTime ? (
                      <div className="scheduled-cell">
                        <span className="time-main">
                          {new Date(email.scheduledTime).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {email.status === 'SCHEDULED' && (
                          <span className="time-countdown">{formatCountdown(email.scheduledTime)}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-dim">---</span>
                    )}
                  </td>
                  <td>
                    {email.status === 'SENT' && email.sentAt ? (
                      <span className="text-success text-xs">
                        Sent {new Date(email.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    ) : email.status === 'FAILED' ? (
                      <span className="text-danger text-xs" title={email.lastError || 'Delivery failed'}>
                        {email.lastError ? email.lastError.slice(0, 30) + '...' : 'Delivery failed'}
                      </span>
                    ) : email.attemptCount > 0 ? (
                      <span className="text-warning text-xs">Attempt #{email.attemptCount}</span>
                    ) : (
                      <span className="text-dim">---</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row-actions">
                      {onSelectEmail && (
                        <button
                          className="btn-icon"
                          title="View Details"
                          onClick={() => onSelectEmail(email)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      )}

                      {email.status === 'SCHEDULED' && (
                        <button
                          className="btn-cancel-pill"
                          disabled={actionInProgressId === email.id}
                          onClick={() => handleCancel(email.id)}
                          title="Cancel Scheduled Delivery"
                        >
                          {actionInProgressId === email.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      )}

                      {email.status === 'DRAFT' && (
                        <button
                          className="btn-icon btn-icon-danger"
                          disabled={actionInProgressId === email.id}
                          onClick={() => handleDelete(email.id)}
                          title="Delete Draft"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer */}
      <div className="pagination-bar">
        <span className="pagination-info">
          Showing {emails.length} of {totalCount} email{totalCount === 1 ? '' : 's'}
        </span>
        <div className="pagination-btns">
          <button
            className="btn btn-secondary btn-sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="pagination-page">
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};
