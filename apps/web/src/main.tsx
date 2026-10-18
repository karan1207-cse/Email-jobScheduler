import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { API_BASE_URL, IS_EMBEDDED_BUILD } from './api.js';
import './index.css';

// A hosted standalone copy of the dashboard forwards to the API's address,
// which serves the same dashboard. Keeping the dashboard and API on one site
// lets the sign-in cookie work in every browser, including Safari and iOS.
const apiOrigin = new URL(API_BASE_URL, window.location.href).origin;
const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const forwardToApi =
  import.meta.env.PROD && !IS_EMBEDDED_BUILD && !isLocalHost && apiOrigin !== window.location.origin;

if (forwardToApi) {
  const { pathname, search, hash } = window.location;
  window.location.replace(`${apiOrigin}${pathname}${search}${hash}`);
} else {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
