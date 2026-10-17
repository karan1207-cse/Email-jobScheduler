import React, { useState } from 'react';
import { createDraftEmail, scheduleEmail } from '../api.js';

interface ComposeCampaignProps {
  onSuccess: () => void;
}

export const ComposeCampaign: React.FC<ComposeCampaignProps> = ({ onSuccess }) => {
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>(
    'Hello {{name}},\n\nThank you for reaching out. We wanted to confirm your registration for ReachInbox.\n\nBest regards,\nThe Team'
  );

  // Recipient input mode: 'paste' or 'upload'
  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('paste');
  const [rawTextRecipients, setRawTextRecipients] = useState<string>(
    'alex@company.com\nsarah.connor@cyberdyne.org, john.doe@example.com'
  );
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Parsed recipients state
  const [parsedRecipients, setParsedRecipients] = useState<string[]>([
    'alex@company.com',
    'sarah.connor@cyberdyne.org',
    'john.doe@example.com',
  ]);
  const [duplicateCount, setDuplicateCount] = useState<number>(0);

  // Scheduling options
  const [scheduleOption, setScheduleOption] = useState<'immediate' | '5m' | '1h' | 'custom'>('5m');
  const [customDateTime, setCustomDateTime] = useState<string>(() => {
    const d = new Date(Date.now() + 10 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [pacingIntervalSec, setPacingIntervalSec] = useState<number>(2);

  // Submission progress
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Helper to extract emails from raw string
  const parseEmailsFromString = (text: string) => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(emailRegex) || [];
    const unique = new Set<string>();
    let dups = 0;

    for (const email of matches) {
      const lower = email.trim().toLowerCase();
      if (unique.has(lower)) {
        dups++;
      } else {
        unique.add(lower);
      }
    }

    setDuplicateCount(dups);
    setParsedRecipients(Array.from(unique));
  };

  const handleRawTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setRawTextRecipients(val);
    parseEmailsFromString(val);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      parseEmailsFromString(content);
    };
    reader.readAsText(file);
  };

  const calculateStartTime = (index: number): Date => {
    let baseDate: Date;
    const now = Date.now();

    if (scheduleOption === 'immediate') {
      baseDate = new Date(now + 2000); // 2s buffer for BullMQ
    } else if (scheduleOption === '5m') {
      baseDate = new Date(now + 5 * 60 * 1000);
    } else if (scheduleOption === '1h') {
      baseDate = new Date(now + 60 * 60 * 1000);
    } else {
      baseDate = new Date(customDateTime);
    }

    // Add staggered delay for pacing
    return new Date(baseDate.getTime() + index * pacingIntervalSec * 1000);
  };

  const handleScheduleCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) {
      setError('Subject line is required.');
      return;
    }
    if (!body.trim()) {
      setError('Email body is required.');
      return;
    }
    if (parsedRecipients.length === 0) {
      setError('At least one valid recipient email is required.');
      return;
    }

    setError(null);
    setSubmitting(true);
    setProgress({ current: 0, total: parsedRecipients.length, message: 'Initiating campaign batch...' });

    try {
      for (let i = 0; i < parsedRecipients.length; i++) {
        const recipient = parsedRecipients[i]!;
        setProgress({
          current: i + 1,
          total: parsedRecipients.length,
          message: `Creating & scheduling email ${i + 1} of ${parsedRecipients.length} to ${recipient}...`,
        });

        // 1. Create draft
        const draft = await createDraftEmail({
          recipient,
          subject: subject.trim(),
          body: body.trim(),
        });

        // 2. Schedule draft
        const scheduledTime = calculateStartTime(i).toISOString();
        await scheduleEmail(draft.id, scheduledTime);
      }

      setProgress({
        current: parsedRecipients.length,
        total: parsedRecipients.length,
        message: 'Campaign scheduled successfully!',
      });

      setTimeout(() => {
        onSuccess();
      }, 700);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to schedule campaign.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="campaign-container">
      <div className="campaign-header">
        <div>
          <h2>Compose &amp; Schedule Campaign</h2>
          <p className="section-desc">
            Define template content, upload lead recipients (CSV/TXT), and set automated delivery pacing.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert-box alert-danger">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      <form onSubmit={handleScheduleCampaign} className="campaign-form">
        <div className="campaign-grid">
          {/* Left Column: Email Content */}
          <div className="form-column">
            <div className="card-glass">
              <h3 className="card-title">1. Email Template</h3>

              <div className="form-group">
                <label htmlFor="campaign-subject">Subject Line *</label>
                <input
                  id="campaign-subject"
                  type="text"
                  className="input-field"
                  placeholder="e.g. Accelerate your pipeline with ReachInbox"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="campaign-body">Email Body (Plain Text or HTML) *</label>
                <textarea
                  id="campaign-body"
                  rows={8}
                  className="input-field textarea-field"
                  placeholder="Compose your email message..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
            </div>
          </div>

          {/* Right Column: Recipients & Pacing */}
          <div className="form-column">
            <div className="card-glass">
              <div className="card-title-row">
                <h3 className="card-title">2. Recipients &amp; Leads</h3>
                <div className="toggle-group">
                  <button
                    type="button"
                    className={`toggle-btn ${inputMode === 'paste' ? 'active' : ''}`}
                    onClick={() => setInputMode('paste')}
                  >
                    Paste Text
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${inputMode === 'upload' ? 'active' : ''}`}
                    onClick={() => setInputMode('upload')}
                  >
                    Upload File
                  </button>
                </div>
              </div>

              {inputMode === 'upload' ? (
                <div className="file-dropzone">
                  <input
                    type="file"
                    id="lead-file-input"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="file-input-hidden"
                    disabled={submitting}
                  />
                  <label htmlFor="lead-file-input" className="file-dropzone-label">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Click to browse or drop CSV/TXT file</span>
                    <span className="file-hint">Formats: .csv, .txt with email addresses</span>
                  </label>
                  {uploadedFileName && (
                    <div className="file-selected-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {uploadedFileName}
                    </div>
                  )}
                </div>
              ) : (
                <div className="form-group">
                  <label htmlFor="campaign-recipients">Paste Emails (comma, space, or newline separated)</label>
                  <textarea
                    id="campaign-recipients"
                    rows={4}
                    className="input-field textarea-field"
                    placeholder="user1@example.com&#10;user2@company.org"
                    value={rawTextRecipients}
                    onChange={handleRawTextChange}
                    disabled={submitting}
                  />
                </div>
              )}

              {/* Lead Validation Summary */}
              <div className="lead-summary-bar">
                <div className="stat-pill">
                  <span className="stat-count">{parsedRecipients.length}</span>
                  <span className="stat-label">Valid Recipients</span>
                </div>
                {duplicateCount > 0 && (
                  <div className="stat-pill stat-pill-warning">
                    <span className="stat-count">{duplicateCount}</span>
                    <span className="stat-label">Duplicates Removed</span>
                  </div>
                )}
              </div>

              {/* Preview Chips */}
              {parsedRecipients.length > 0 && (
                <div className="recipients-chips-preview">
                  {parsedRecipients.slice(0, 6).map((email, idx) => (
                    <span key={idx} className="email-chip">
                      {email}
                    </span>
                  ))}
                  {parsedRecipients.length > 6 && (
                    <span className="email-chip email-chip-more">
                      +{parsedRecipients.length - 6} more
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Scheduling & Pacing Settings */}
            <div className="card-glass" style={{ marginTop: '1.25rem' }}>
              <h3 className="card-title">3. Delivery Schedule &amp; Pacing</h3>

              <div className="form-group">
                <label>Start Delivery Time</label>
                <div className="schedule-pills-row">
                  <button
                    type="button"
                    className={`pill-choice ${scheduleOption === 'immediate' ? 'active' : ''}`}
                    onClick={() => setScheduleOption('immediate')}
                  >
                    Immediate
                  </button>
                  <button
                    type="button"
                    className={`pill-choice ${scheduleOption === '5m' ? 'active' : ''}`}
                    onClick={() => setScheduleOption('5m')}
                  >
                    In 5 Minutes
                  </button>
                  <button
                    type="button"
                    className={`pill-choice ${scheduleOption === '1h' ? 'active' : ''}`}
                    onClick={() => setScheduleOption('1h')}
                  >
                    In 1 Hour
                  </button>
                  <button
                    type="button"
                    className={`pill-choice ${scheduleOption === 'custom' ? 'active' : ''}`}
                    onClick={() => setScheduleOption('custom')}
                  >
                    Custom Time
                  </button>
                </div>
              </div>

              {scheduleOption === 'custom' && (
                <div className="form-group">
                  <label htmlFor="custom-datetime">Scheduled Date &amp; Time (Local)</label>
                  <input
                    id="custom-datetime"
                    type="datetime-local"
                    className="input-field"
                    value={customDateTime}
                    onChange={(e) => setCustomDateTime(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="pacing-delay">
                  Pacing Delay Between Emails (Seconds)
                  <span className="label-hint">Mitigates rate limiting across concurrent sends</span>
                </label>
                <input
                  id="pacing-delay"
                  type="number"
                  min="0"
                  max="3600"
                  className="input-field"
                  value={pacingIntervalSec}
                  onChange={(e) => setPacingIntervalSec(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  disabled={submitting}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Submission & Progress Footer */}
        <div className="campaign-footer">
          {progress && (
            <div className="progress-container">
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <span className="progress-text">{progress.message}</span>
            </div>
          )}

          <div className="footer-actions">
            <button
              type="submit"
              className="btn btn-primary btn-large"
              disabled={submitting || parsedRecipients.length === 0}
            >
              {submitting ? (
                <>
                  <div className="spinner-sm" />
                  Scheduling {parsedRecipients.length} Emails...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Schedule Campaign ({parsedRecipients.length} Emails)
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
