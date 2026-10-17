import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../api.js';

export interface SlackStatus {
  connected: boolean;
  configured: boolean;
  teamName?: string | null;
  channelName?: string | null;
  teamId?: string | null;
}

export const SlackSettings: React.FC = () => {
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [testing, setTesting] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Manual webhook input state
  const [showManualWebhook, setShowManualWebhook] = useState<boolean>(false);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [channelName, setChannelName] = useState<string>('#email-alerts');
  const [savingWebhook, setSavingWebhook] = useState<boolean>(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/slack/status`, {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as SlackStatus;
        setStatus(data);
      }
    } catch (err) {
      console.warn('[Slack] Failed to query status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check URL parameters for OAuth return
    const params = new URLSearchParams(window.location.search);
    const slackConnected = params.get('slack_connected');
    const slackError = params.get('slack_error');

    if (slackConnected) {
      setFeedback({ type: 'success', message: 'Slack workspace connected successfully!' });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (slackError) {
      setFeedback({ type: 'error', message: `Slack OAuth failed: ${decodeURIComponent(slackError)}` });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    fetchStatus();
  }, [fetchStatus]);

  const handleConnectOAuth = () => {
    window.location.href = `${API_BASE_URL}/auth/slack`;
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Slack alerts from your account?')) {
      return;
    }
    setDisconnecting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/slack/disconnect`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Slack disconnected.' });
        setStatus((s) => (s ? { ...s, connected: false, teamName: null, channelName: null } : null));
      } else {
        throw new Error('Failed to disconnect.');
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Could not disconnect Slack.' });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleTestAlert = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/slack/test`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Test alert delivered to Slack channel!' });
      } else {
        throw new Error(data?.error?.message || 'Slack test message failed.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send test alert.';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveDirectWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      setFeedback({ type: 'error', message: 'Invalid URL. Slack webhooks must begin with https://hooks.slack.com/' });
      return;
    }
    setSavingWebhook(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/slack/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ webhookUrl, channelName }),
      });
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Slack webhook saved and activated!' });
        setShowManualWebhook(false);
        fetchStatus();
      } else {
        throw new Error('Failed to save webhook.');
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to configure direct webhook.' });
    } finally {
      setSavingWebhook(false);
    }
  };

  return (
    <div className="card-glass slack-settings-card">
      <div className="slack-header">
        <div className="slack-brand">
          <svg width="24" height="24" viewBox="0 0 24 24">
            <path
              fill="#E01E5A"
              d="M5.04 14.5a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52zm1.26 0a2.52 2.52 0 0 1 5.04 0v6.3a2.52 2.52 0 1 1-5.04 0v-6.3z"
            />
            <path
              fill="#36C5F0"
              d="M9.5 5.04a2.52 2.52 0 1 1 2.52-2.52v2.52H9.5zm0 1.26a2.52 2.52 0 0 1 0 5.04H3.2a2.52 2.52 0 1 1 0-5.04H9.5z"
            />
            <path
              fill="#2EB67D"
              d="M18.96 9.5a2.52 2.52 0 1 1 2.52 2.52h-2.52V9.5zm-1.26 0a2.52 2.52 0 0 1-5.04 0V3.2a2.52 2.52 0 1 1 5.04 0V9.5z"
            />
            <path
              fill="#ECB22E"
              d="M14.5 18.96a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52zm0-1.26a2.52 2.52 0 0 1 0-5.04h6.3a2.52 2.52 0 1 1 0 5.04H14.5z"
            />
          </svg>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Slack Rate-Limit Alerting</h3>
            <span className="section-desc">Automated alerts when worker sending quotas or pacing limits engage</span>
          </div>
        </div>

        <div className="slack-status-pill">
          {loading ? (
            <span className="status-pill">Checking...</span>
          ) : status?.connected ? (
            <span className="status-pill healthy">Connected</span>
          ) : (
            <span className="status-pill unhealthy">Not Connected</span>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`alert-box alert-${feedback.type === 'success' ? 'success' : 'danger'}`} style={{ marginTop: '1rem' }}>
          <span>{feedback.message}</span>
          <button className="btn-alert-dismiss" onClick={() => setFeedback(null)}>
            &times;
          </button>
        </div>
      )}

      <div className="slack-body" style={{ marginTop: '1rem' }}>
        {status?.connected ? (
          <div className="slack-connected-view">
            <div className="slack-meta-box">
              <div className="meta-item">
                <span className="meta-label">Workspace</span>
                <span className="meta-val">{status.teamName || 'Slack Team'}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Target Channel</span>
                <span className="meta-val font-semibold">{status.channelName || '#email-alerts'}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Deduplication</span>
                <span className="meta-val">5-min Redis Window</span>
              </div>
            </div>

            <div className="slack-actions-row">
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleTestAlert}
                disabled={testing}
              >
                {testing ? 'Sending...' : 'Send Test Notification'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{ color: '#f87171' }}
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <div className="slack-disconnected-view">
            <p className="section-desc" style={{ marginBottom: '1rem' }}>
              Connect your Slack workspace so your team receives automated alerts when the hourly rate limit is reached.
            </p>

            <div className="slack-actions-row">
              <button
                className="btn btn-primary btn-sm"
                onClick={handleConnectOAuth}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Connect with Slack OAuth
              </button>

              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowManualWebhook(!showManualWebhook)}
              >
                {showManualWebhook ? 'Cancel Webhook' : 'Use Incoming Webhook URL'}
              </button>
            </div>

            {showManualWebhook && (
              <form onSubmit={handleSaveDirectWebhook} className="webhook-form" style={{ marginTop: '1rem' }}>
                <div className="form-group">
                  <label htmlFor="webhook-url">Slack Incoming Webhook URL *</label>
                  <input
                    id="webhook-url"
                    type="url"
                    className="input-field"
                    placeholder="https://hooks.slack.com/services/T.../B.../..."
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="webhook-channel">Channel Label</label>
                  <input
                    id="webhook-channel"
                    type="text"
                    className="input-field"
                    placeholder="#email-alerts"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingWebhook}>
                  {savingWebhook ? 'Saving...' : 'Save & Activate Webhook'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
