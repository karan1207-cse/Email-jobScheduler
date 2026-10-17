import React, { useState, useEffect, useCallback } from 'react';
import type { EmailDto, HealthCheckResponse, ApiRootResponse } from '@reachinbox/shared';
import {
  fetchCurrentUser,
  logoutUser,
  listEmails,
  searchEmailsApi,
  fetchApiHealth,
  fetchApiRoot,
  type AuthUser,
} from './api.js';
import { LoginScreen } from './components/LoginScreen.js';
import { Sidebar, type DashboardTab } from './components/Sidebar.js';
import { EmailListView } from './components/EmailListView.js';
import { EmailDetailView } from './components/EmailDetailView.js';
import { ComposeView } from './components/ComposeView.js';
import { SlackSettings } from './components/SlackSettings.js';
import { HealthTelemetry } from './components/HealthTelemetry.js';

export const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true);
  const [authBanner, setAuthBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Dashboard view state
  const [currentTab, setCurrentTab] = useState<DashboardTab>('scheduled');
  const [statusFilterOverride, setStatusFilterOverride] = useState<string | null>(null);
  const [isComposeActive, setIsComposeActive] = useState<boolean>(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailDto | null>(null);

  // Email list state
  const [emails, setEmails] = useState<EmailDto[]>([]);
  const [loadingEmails, setLoadingEmails] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [scheduledCount, setScheduledCount] = useState<number>(0);
  const [sentCount, setSentCount] = useState<number>(0);

  // Telemetry state
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [rootData, setRootData] = useState<ApiRootResponse | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  // 1. Initial auth check
  const checkAuth = useCallback(async () => {
    setLoadingAuth(true);
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

    try {
      const currentUser = await fetchCurrentUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  // 2. Fetch email lists and count statistics
  const fetchDashboardData = useCallback(async () => {
    if (!user) return;
    setLoadingEmails(true);

    try {
      const defaultFilterStatus = currentTab === 'scheduled' ? 'SCHEDULED' : currentTab === 'sent' ? 'SENT' : undefined;
      const filterStatus = statusFilterOverride === 'ALL'
        ? undefined
        : statusFilterOverride ?? defaultFilterStatus;

      // If search query is present, call searchEmailsApi; otherwise listEmails
      const res = searchQuery.trim()
        ? await searchEmailsApi(searchQuery.trim(), filterStatus)
        : await listEmails(1, 50, filterStatus);
      setEmails(res.data || []);

      // Fetch counts for both tabs concurrently
      const [scheduledRes, sentRes] = await Promise.all([
        listEmails(1, 1, 'SCHEDULED').catch(() => null),
        listEmails(1, 1, 'SENT').catch(() => null),
      ]);

      setScheduledCount(scheduledRes?.pagination.total ?? 0);
      setSentCount(sentRes?.pagination.total ?? 0);
    } catch (err) {
      console.error('[Dashboard] Error fetching email data:', err);
      setEmails([]);
      setScheduledCount(0);
      setSentCount(0);
      setAuthBanner({ type: 'error', message: err instanceof Error ? err.message : 'Could not load emails.' });
    } finally {
      setLoadingEmails(false);
    }
  }, [user, currentTab, searchQuery, statusFilterOverride]);

  // 3. Fetch system telemetry
  const fetchTelemetry = useCallback(async () => {
    try {
      const [h, r] = await Promise.all([
        fetchApiHealth().catch(() => null),
        fetchApiRoot().catch(() => null),
      ]);
      setHealthData(h);
      setRootData(r);
      setHttpStatus(h ? 200 : 503);
      setLastChecked(new Date().toLocaleTimeString());
    } catch {
      setHttpStatus(503);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
      fetchTelemetry();
    }
  }, [user, fetchDashboardData, fetchTelemetry]);

  // Handle logout
  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (err) {
      console.warn('Logout warning:', err);
    }
    setUser(null);
    setSelectedEmail(null);
    setIsComposeActive(false);
    setAuthBanner({ type: 'success', message: 'You have been signed out.' });
  };

  // If loading auth state
  if (loadingAuth) {
    return (
      <div className="figma-login-wrapper">
        <div className="figma-spinner"></div>
      </div>
    );
  }

  // 1️⃣ NOT LOGGED IN -> Show Figma Login Screen
  if (!user) {
    return (
      <LoginScreen
        onLoginSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          setAuthBanner({ type: 'success', message: `Welcome back, ${loggedInUser.displayName}!` });
        }}
        authError={authBanner?.type === 'error' ? authBanner.message : null}
      />
    );
  }

  // 2️⃣ LOGGED IN -> Show Figma Main Dashboard
  return (
    <div className="figma-dashboard-layout">
      {/* Left Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={(tab) => {
          setCurrentTab(tab);
          setStatusFilterOverride(null);
          setSelectedEmail(null);
          setIsComposeActive(false);
        }}
        onComposeClick={() => {
          setIsComposeActive(true);
          setSelectedEmail(null);
        }}
        user={user}
        onLogout={handleLogout}
        scheduledCount={scheduledCount}
        sentCount={sentCount}
        isComposeActive={isComposeActive}
      />

      {/* Main Content Area */}
      <main className="figma-main-content">
        {/* Top Banner Alert (e.g. OAuth Success) */}
        {authBanner && (
          <div className={`figma-top-alert alert-${authBanner.type}`}>
            <span>{authBanner.message}</span>
            <button
              type="button"
              className="figma-error-close"
              onClick={() => setAuthBanner(null)}
            >
              &times;
            </button>
          </div>
        )}

        {/* View Switcher */}
        {isComposeActive ? (
          <ComposeView
            onBack={() => setIsComposeActive(false)}
            onSuccess={() => {
              setIsComposeActive(false);
              setCurrentTab('scheduled');
              setStatusFilterOverride(null);
              fetchDashboardData();
            }}
            currentUser={user}
          />
        ) : selectedEmail ? (
          <EmailDetailView
            email={selectedEmail}
            onBack={() => setSelectedEmail(null)}
            currentUser={user}
            onEmailUpdated={() => {
              fetchDashboardData();
            }}
          />
        ) : currentTab === 'slack' ? (
          <div style={{ padding: '2rem' }}>
            <SlackSettings />
          </div>
        ) : currentTab === 'health' ? (
          <div style={{ padding: '2rem' }}>
            <HealthTelemetry
              healthData={healthData}
              rootData={rootData}
              httpStatus={httpStatus}
              loading={false}
              onRefresh={fetchTelemetry}
              lastChecked={lastChecked}
              apiBaseUrl="http://localhost:5000"
            />
          </div>
        ) : (
          <EmailListView
            emails={emails}
            loading={loadingEmails}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onRefresh={fetchDashboardData}
            onSelectEmail={setSelectedEmail}
            activeTab={currentTab}
            statusFilter={statusFilterOverride ?? 'CURRENT'}
            onStatusFilterChange={(status) => setStatusFilterOverride(status === 'CURRENT' ? null : status)}
          />
        )}
      </main>
    </div>
  );
};
