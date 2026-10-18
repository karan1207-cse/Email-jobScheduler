/**
 * Serves the dashboard from the API's own address.
 *
 * With the dashboard and API on one site the session cookie is first-party,
 * so sign-in works in every browser (Safari and iOS block the cross-site
 * cookie a separate dashboard site needs). On by default on Render
 * (RENDER=true); SERVE_WEB=true/false forces it on or off.
 *
 * Browser page loads get the dashboard; API calls (which ask for JSON) and the
 * API's own paths are left to the API routes.
 */
import express, { type Application, type Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const API_PATH_PREFIXES = ['/api', '/auth', '/admin', '/health', '/ready'];

export function webDistDir(): string {
  // dist/web.js → apps/api/dist → apps/web/dist-embedded
  return process.env.WEB_DIST_DIR || path.resolve(__dirname, '../../web/dist-embedded');
}

export function isWebEmbedded(): boolean {
  const flag = process.env.SERVE_WEB?.toLowerCase();
  const wanted = flag === 'true' || (flag !== 'false' && process.env.RENDER === 'true');
  return wanted && fs.existsSync(path.join(webDistDir(), 'index.html'));
}

/**
 * Where to send the browser after OAuth: the API's own dashboard when it
 * serves one, otherwise FRONTEND_URL. `query` starts with "?".
 */
export function frontendUrl(query = ''): string {
  return `${isWebEmbedded() ? '/' : config.FRONTEND_URL}${query}`;
}

function wantsHtmlPage(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (API_PATH_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
    return false;
  }
  return req.accepts(['json', 'html']) === 'html';
}

export function mountWeb(app: Application): void {
  if (!isWebEmbedded()) return;
  const dir = webDistDir();
  const indexFile = path.join(dir, 'index.html');

  app.use('/assets', express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use('/assets', (_req, res) => {
    res.status(404).end();
  });
  app.use((req, res, next) => {
    if (!wantsHtmlPage(req)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
  console.log(`[Web] Serving the dashboard from ${dir}`);
}
