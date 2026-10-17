import React, { useState, useRef } from 'react';
import type { AuthUser } from '../api.js';
import { createDraftEmail, scheduleEmail } from '../api.js';

interface ComposeViewProps {
  onBack: () => void;
  onSuccess: () => void;
  currentUser: AuthUser;
}

export const ComposeView: React.FC<ComposeViewProps> = ({
  onBack,
  onSuccess,
  currentUser,
}) => {
  const [recipient, setRecipient] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [delaySec, setDelaySec] = useState<string>('02');
  const [hourlyLimit, setHourlyLimit] = useState<string>('50');

  // Recipient list for bulk upload
  const [recipientList, setRecipientList] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);

  // Send Later popover state
  const [sendLaterOpen, setSendLaterOpen] = useState<boolean>(false);
  const [selectedScheduleTime, setSelectedScheduleTime] = useState<string>(() => {
    // Default tomorrow at 10:00 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
    return tomorrow.toISOString().slice(0, 16);
  });
  const [isScheduledMode, setIsScheduledMode] = useState<boolean>(false);

  // Attachments
  const [attachments, setAttachments] = useState<Array<{ filename: string; contentType: string; size: number; contentBase64: string }>>([]);

  // Submission state
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const handleAttachments = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    if (attachments.length + files.length > 5) {
      setError('Attach up to 5 files per email.');
      return;
    }
    const nextTotal = attachments.reduce((sum, file) => sum + file.size, 0) + files.reduce((sum, file) => sum + file.size, 0);
    if (files.some((file) => file.size === 0 || file.size > 5 * 1024 * 1024) || nextTotal > 8 * 1024 * 1024) {
      setError('Each attachment must be under 5 MB, with 8 MB total per email.');
      return;
    }

    try {
      const encoded = await Promise.all(files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          contentBase64: btoa(binary),
        };
      }));
      setAttachments((current) => [...current, ...encoded]);
      setError(null);
    } catch {
      setError('One or more files could not be read. Please try again.');
    }
  };

  // Quick schedule presets
  const handleQuickPreset = (preset: 'tomorrow' | '10am' | '11am' | '3pm') => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    if (preset === 'tomorrow' || preset === '10am') {
      d.setHours(10, 0, 0, 0);
    } else if (preset === '11am') {
      d.setHours(11, 0, 0, 0);
    } else if (preset === '3pm') {
      d.setHours(15, 0, 0, 0);
    }
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setSelectedScheduleTime(d.toISOString().slice(0, 16));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const found = content.match(emailRegex) || [];
      const unique = Array.from(new Set(found.map((e) => e.trim().toLowerCase())));
      if (unique.length > 0) {
        setRecipientList(unique);
        setRecipient(unique[0] || '');
      } else {
        alert('No valid emails found in the file.');
      }
    };
    reader.readAsText(file);
  };

  const handleSend = async () => {
    const targetRecipients = recipientList.length > 0
      ? recipientList
      : recipient.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean);

    const invalidRecipient = targetRecipients.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (targetRecipients.length === 0 || invalidRecipient) {
      setError('Please provide at least one valid recipient email.');
      return;
    }
    if (!subject.trim()) {
      setError('Please enter an email subject.');
      return;
    }
    if (!body.trim()) {
      setError('Please compose an email body.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const requestedDelaySec = Number(delaySec);
      const requestedHourlyLimit = Number(hourlyLimit);
      if (!Number.isInteger(requestedDelaySec) || requestedDelaySec < 0) {
        throw new Error('Delay must be a whole number of seconds greater than or equal to zero.');
      }
      if (!Number.isInteger(requestedHourlyLimit) || requestedHourlyLimit < 0) {
        throw new Error('Hourly limit must be a whole number greater than or equal to zero.');
      }
      const pacingDelayMs = requestedDelaySec * 1000;
      const hourlyCapDelayMs = requestedHourlyLimit > 0
        ? Math.ceil(3_600_000 / requestedHourlyLimit)
        : 0;
      const delayMs = Math.max(pacingDelayMs, hourlyCapDelayMs);
      const baseTime = isScheduledMode ? new Date(selectedScheduleTime).getTime() : Date.now() + 3000;
      if (!Number.isFinite(baseTime) || baseTime <= Date.now()) {
        throw new Error('Choose a send time in the future.');
      }

      for (let i = 0; i < targetRecipients.length; i++) {
        const to = targetRecipients[i]!;
        const draft = await createDraftEmail({
          recipient: to,
          subject: subject.trim(),
          body: body.trim(),
          attachments,
        });

        // Stagger dispatches according to pacing interval
        const itemScheduledTime = new Date(baseTime + i * delayMs).toISOString();
        await scheduleEmail(draft.id, itemScheduledTime);
      }

      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to schedule campaign.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="figma-compose-container">
      {/* Top Header */}
      <div className="figma-compose-top-bar">
        <div className="compose-top-left">
          <button type="button" className="figma-back-btn" onClick={onBack} title="Cancel and return">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h2 className="compose-title">Compose New Email</h2>
        </div>

        <div className="compose-top-actions">
          {/* Paperclip attachment icon with badge */}
          <button
            type="button"
            className="icon-action-btn with-badge"
            onClick={() => attachmentInputRef.current?.click()}
            title="Attach files"
            aria-label="Attach files"
            aria-controls="compose-attachment-input"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F767E" strokeWidth="2">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <span className="action-badge">{attachments.length}</span>
          </button>
          <input
            ref={attachmentInputRef}
            id="compose-attachment-input"
            type="file"
            multiple
            onChange={(event) => void handleAttachments(event)}
            className="visually-hidden"
            aria-label="Choose email attachments"
          />

          {/* Clock icon to toggle Send Later modal */}
          <button
            type="button"
            className={`icon-action-btn ${sendLaterOpen ? 'active' : ''}`}
            onClick={() => setSendLaterOpen(!sendLaterOpen)}
            title="Schedule send time"
            id="compose-schedule-clock-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isScheduledMode ? '#00A859' : '#6F767E'} strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>

          {/* Main Action Send Button */}
          <button
            type="button"
            className="figma-send-pill-btn"
            onClick={handleSend}
            disabled={submitting}
            id="compose-send-btn"
          >
            {submitting ? 'Sending...' : isScheduledMode ? 'Schedule Send' : 'Send'}
          </button>
        </div>
      </div>

      {/* Send Later Popover (Figma Image 3 Left) */}
      {sendLaterOpen && (
        <div className="figma-send-later-popover" id="send-later-popover">
          <div className="popover-header">
            <h3>Send Later</h3>
          </div>

          <div className="popover-body">
            <button
              type="button"
              className="send-now-option"
              onClick={() => { setIsScheduledMode(false); setSendLaterOpen(false); }}
            >
              Send immediately
            </button>
            <label className="popover-input-label">Pick date &amp; time</label>
            <div className="popover-input-wrapper">
              <input
                type="datetime-local"
                className="popover-datetime-input"
                value={selectedScheduleTime}
                onChange={(e) => {
                  setSelectedScheduleTime(e.target.value);
                  setIsScheduledMode(true);
                }}
              />
            </div>

            <div className="quick-presets-list">
              <button
                type="button"
                className="preset-item"
                onClick={() => handleQuickPreset('tomorrow')}
              >
                Tomorrow
              </button>
              <button
                type="button"
                className="preset-item"
                onClick={() => handleQuickPreset('10am')}
              >
                Tomorrow, 10:00 AM
              </button>
              <button
                type="button"
                className="preset-item"
                onClick={() => handleQuickPreset('11am')}
              >
                Tomorrow, 11:00 AM
              </button>
              <button
                type="button"
                className="preset-item"
                onClick={() => handleQuickPreset('3pm')}
              >
                Tomorrow, 3:00 PM
              </button>
            </div>
          </div>

          <div className="popover-footer">
            <button
              type="button"
              className="popover-cancel-btn"
              onClick={() => {
                setSendLaterOpen(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="popover-done-btn"
              onClick={() => {
                setIsScheduledMode(true);
                setSendLaterOpen(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="figma-compose-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {/* Main Form Fields */}
      <div className="figma-compose-form">
        {/* From Row */}
        <div className="compose-row">
          <label className="compose-label">From</label>
          <div className="compose-from-pill">
            <span>{currentUser.email}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {/* To Row with Upload List button */}
        <div className="compose-row">
          <label className="compose-label">To</label>
          <div className="compose-input-wrapper">
            <input
              type="text"
              className="compose-input"
              placeholder="recipient@example.com"
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value);
                setRecipientList([]);
                setFileName(null);
              }}
              id="compose-to-input"
            />
            {recipientList.length > 0 && (
              <span className="recipients-badge">
                {recipientList.length} leads loaded ({fileName})
              </span>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".csv,.txt"
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="upload-list-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Upload CSV or TXT lead list"
              id="upload-lead-list-btn"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Upload List</span>
            </button>
          </div>
        </div>

        {/* Subject Row */}
        <div className="compose-row">
          <label className="compose-label">Subject</label>
          <input
            type="text"
            className="compose-input"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            id="compose-subject-input"
          />
        </div>

        {/* Rate Limiting & Pacing Delay Row (matching Figma Image 3) */}
        <div className="compose-row pacing-row">
          <div className="pacing-field">
            <label className="pacing-label">Delay between 2 emails (s)</label>
            <input
              type="number"
              className="pacing-input"
              value={delaySec}
              onChange={(e) => setDelaySec(e.target.value)}
              min="0"
              placeholder="00"
            />
          </div>

          <div className="pacing-field">
            <label className="pacing-label">Hourly Limit</label>
            <input
              type="number"
              className="pacing-input"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              min="0"
              placeholder="00"
            />
          </div>
        </div>

        {/* Rich Editor Area with Toolbar */}
        <div className="figma-editor-container">
          <div className="figma-editor-toolbar">
            <button type="button" className="toolbar-btn" title="Undo">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>
            </button>
            <button type="button" className="toolbar-btn" title="Redo">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></svg>
            </button>
            <div className="toolbar-divider"></div>
            <button type="button" className="toolbar-btn text-style-btn" title="Typography">
              <span>TT ▾</span>
            </button>
            <button type="button" className="toolbar-btn font-bold" title="Bold">
              <strong>B</strong>
            </button>
            <button type="button" className="toolbar-btn font-italic" title="Italic">
              <em>I</em>
            </button>
            <button type="button" className="toolbar-btn font-underline" title="Underline">
              <u>U</u>
            </button>
            <div className="toolbar-divider"></div>
            <button type="button" className="toolbar-btn" title="Align">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="3" y2="18" /></svg>
            </button>
            <button type="button" className="toolbar-btn" title="Bullet List">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
            </button>
            <button type="button" className="toolbar-btn" title="Quote">
              <span>”</span>
            </button>
            <button type="button" className="toolbar-btn" title="Link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            </button>
          </div>

          <textarea
            className="figma-editor-textarea"
            placeholder="Type Your Reply..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            id="compose-body-textarea"
          />

          {/* Attachment card preview at bottom if attached */}
          {attachments.length > 0 && (
            <div className="compose-attachment-preview">
              {attachments.map((attachment, index) => (
                <div className="attachment-chip" key={`${attachment.filename}-${index}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00A859" strokeWidth="2" aria-hidden="true">
                    <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span>{attachment.filename}</span>
                  <span className="attachment-file-size">{(attachment.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    className="remove-chip-btn"
                    aria-label={`Remove ${attachment.filename}`}
                    onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
