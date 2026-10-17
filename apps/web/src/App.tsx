import React, { useState, useEffect, useCallback } from 'react';
import type { HealthCheckResponse, ApiRootResponse, EmailDto } from '@reachinbox/shared';
import {
  API_BASE_URL,
  fetchCurrentUser,
  logoutUser,
  fetchApiHealth,
  fetchApiRoot,
  type AuthUser,
} from './api.js';
import { Navbar, type ActiveTab } from './components/Navbar.js';
import { ComposeCampaign } from './components/ComposeCampaign.js';
import { EmailList } from './components/EmailList.js';
import { EmailDetailModal } from './components/EmailDetailModal.js';
import { HealthTelemetry } from './components/HealthTelemetry.js';
import { SlackSettings } from './components/SlackSettings.js';
import { Footer } from './components/Footer.js';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailDto | null>(null);

  // Health and telemetry state
  const [loadingHealth, setLoadingHealth] = useState<boolean>(true);
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [rootData, setRootData] = useState<ApiRootResponse | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [authBanner, setAuthBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load authenticated user and check URL query params for OAuth return
  const checkAuth = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const authSuccess = params.get('auth_success');
    const authError = params.get('auth_error');

    if (authSuccess) {
      setAuthBanner({ type: 'success', message: 'Successfully signed in with Google OAuth!' });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (authError) {
      setAuthBanner({ type: 'error', message: `Authentication error: ${decodeURIComponent(authError)}` });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const currentUser = await fetchCurrentUser();
    setUser(currentUser);
  }, []);

  const handleLogout = async () => {
    try {
      await logoutUser();
      setUser(null);
      setAuthBanner({ type: 'success', message: 'Signed out successfully.' });
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const fetchHealthTelemetry = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const [h, r] = await Promise.all([
        fetchApiHealth().catch(() => null),
        fetchApiRoot().catch(() => null),
      ]);
      setHealthData(h);
      setRootData(r);
      setHttpStatus(h ? 200 : 503);
      setLastChecked(new Date().toLocaleTimeString());
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
    fetchHealthTelemetry();
  }, [checkAuth, fetchHealthTelemetry]);

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        user={user}
        onLogout={handleLogout}
        isHealthy={healthData?.status === 'healthy'}
      />

      {/* Auth Banner if returned from OAuth */}
      {authBanner && (
        <div className={`alert-box alert-${authBanner.type === 'success' ? 'success' : 'danger'}`}>
          <span>{authBanner.message}</span>
          <button className="btn-alert-dismiss" onClick={() => setAuthBanner(null)}>
            &times;
          </button>
        </div>
      )}

      {/* Main Tab Content */}
      <main className="tab-main-content">
        {activeTab === 'overview' && (
          <div className="overview-tab-view">
            {/* Hero Quick-Action Banner */}
            <div className="hero-banner">
              <div className="hero-text">
                <span className="hero-tag">ReachInbox Email Job Scheduler</span>
                <h1>Distributed Delayed Email Delivery Engine</h1>
                <p>
                  High-throughput, reliable email scheduling platform with transactional outbox, BullMQ delayed
                  queues, distributed rate limiting, and atomic SMTP concurrency.
                </p>
                <div className="hero-buttons">
                  <button className="btn btn-primary" onClick={() => setActiveTab('compose')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Schedule New Campaign
                  </button>
                  <button className="btn btn-secondary" onClick={() => setActiveTab('scheduled')}>
                    View Scheduled Deliveries &rarr;
                  </button>
                </div>
              </div>
            </div>

            {/* Live Telemetry Monitor */}
            <HealthTelemetry
              healthData={healthData}
              rootData={rootData}
              httpStatus={httpStatus}
              loading={loadingHealth}
              onRefresh={fetchHealthTelemetry}
              lastChecked={lastChecked}
              apiBaseUrl={API_BASE_URL}
            />

            {/* Slack Alerting Settings */}
            <div style={{ marginTop: '2rem' }}>
              <SlackSettings />
            </div>

            {/* Recent Scheduled Emails Quick Table */}
            <div style={{ marginTop: '2.5rem' }}>
              <EmailList
                initialStatus="SCHEDULED"
                title="Upcoming Scheduled Deliveries"
                description="Live queues pending dispatch across BullMQ delayed workers."
                onSelectEmail={setSelectedEmail}
              />
            </div>
          </div>
        )}

        {activeTab === 'scheduled' && (
          <EmailList
            initialStatus="SCHEDULED"
            title="Scheduled Email Queue"
            description="Emails scheduled for future delivery. You can cancel any job before it is picked up by a worker."
            onSelectEmail={setSelectedEmail}
          />
        )}

        {activeTab === 'sent' && (
          <EmailList
            initialStatus="SENT"
            title="Sent Email History"
            description="Successfully delivered emails with SMTP message IDs and acceptance timestamps."
            onSelectEmail={setSelectedEmail}
          />
        )}

        {activeTab === 'drafts' && (
          <EmailList
            initialStatus="ALL"
            title="All Email Records &amp; Queue Diagnostics"
            description="Complete audit log including Drafts, Processing leases, and Quarantined failures."
            onSelectEmail={setSelectedEmail}
          />
        )}

        {activeTab === 'compose' && (
          <ComposeCampaign onSuccess={() => setActiveTab('scheduled')} />
        )}
      </main>

      {/* Email Detail Inspection Modal */}
      <EmailDetailModal email={selectedEmail} onClose={() => setSelectedEmail(null)} />

      {/* Footer */}
      <Footer />
    </div>
  );
};
