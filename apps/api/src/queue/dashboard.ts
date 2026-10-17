/**
 * BullMQ Queue Dashboard — Milestone 9
 *
 * Creates the Bull Board Express adapter and exports the router plus a
 * guard middleware for mounting in app.ts.
 *
 * Security model:
 * - Development: localhost, an IP in DASHBOARD_ALLOWED_IPS (defaults to the
 *   VirtualBox NAT host 10.0.2.2 so a host-to-VM port forward works), the
 *   signed-in ADMIN_EMAIL account, or a valid admin token.
 * - Production: requires a valid admin token. If ADMIN_TOKEN is not set in
 *   production, the dashboard is disabled entirely.
 *
 * The admin token can be sent as an X-Admin-Token header, or once as
 * `?token=...` in the browser, which stores it in an HTTP-only cookie scoped
 * to the dashboard path (browsers cannot attach custom headers to navigation).
 */
import crypto from 'node:crypto';

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter }   from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter }  from '@bull-board/express';
import { Queue }           from 'bullmq';
import { Router, type Request, type Response, type NextFunction } from 'express';

const EMAIL_QUEUE_NAME = process.env.EMAIL_QUEUE_NAME || 'email-jobs';
const REDIS_URL        = process.env.REDIS_URL        || 'redis://localhost:6379';
export const DASHBOARD_BASE_PATH = '/admin/queues';

let dashboardQueueInstance: Queue | null = null;

// ---------------------------------------------------------------------------
// Redis connection from URL
// ---------------------------------------------------------------------------

// Keep reconnecting after a Redis restart instead of leaving the dashboard
// permanently broken until the API is restarted.
const DASHBOARD_REDIS_OPTIONS = {
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => Math.min(times * 500, 5000),
};

function parseRedisConnection(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host:     parsed.hostname || 'localhost',
      port:     parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      db:       parseInt(parsed.pathname.replace('/', '') || '0', 10) || 0,
      ...DASHBOARD_REDIS_OPTIONS,
    };
  } catch {
    return { host: 'localhost', port: 6379, ...DASHBOARD_REDIS_OPTIONS };
  }
}

// ---------------------------------------------------------------------------
// Guard middleware
// ---------------------------------------------------------------------------

const ADMIN_COOKIE = 'reachinbox_admin_token';
const DEFAULT_DEV_ALLOWED_IPS = '10.0.2.2';

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isLoopback(ip: string): boolean {
  return ip === '::1' || ip.startsWith('127.');
}

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req: Request, name: string): string {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

/**
 * Returns true when the request carries the admin token. A `?token=` query is
 * moved into a cookie so later asset and API requests from Bull Board pass too.
 */
function hasValidAdminToken(req: Request, res: Response, adminToken: string | undefined): boolean {
  if (!adminToken) return false;
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : '';
  if (queryToken && tokensMatch(queryToken, adminToken)) {
    res.cookie?.(ADMIN_COOKIE, queryToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: (process.env.NODE_ENV || '').toLowerCase() === 'production',
      path: DASHBOARD_BASE_PATH,
    });
    return true;
  }
  const provided = (req.headers['x-admin-token'] as string | undefined) || readCookie(req, ADMIN_COOKIE);
  return Boolean(provided) && tokensMatch(provided, adminToken);
}

/**
 * Protect the dashboard:
 * - In development: localhost, DASHBOARD_ALLOWED_IPS, the signed-in ADMIN_EMAIL, or the admin token.
 * - In production: valid admin token required.
 */
export function dashboardGuard(req: Request, res: Response, next: NextFunction): void {
  const adminToken = process.env.ADMIN_TOKEN;
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (hasValidAdminToken(req, res, adminToken)) {
    next();
    return;
  }

  if (isProd) {
    res.status(403).json({ error: 'Forbidden: invalid or missing admin token.' });
    return;
  }

  const ip = normalizeIp(req.ip ?? req.socket?.remoteAddress ?? '');
  const allowedIps = (process.env.DASHBOARD_ALLOWED_IPS ?? DEFAULT_DEV_ALLOWED_IPS)
    .split(',')
    .map((value) => normalizeIp(value.trim()))
    .filter(Boolean);
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const signedInEmail = req.session?.user?.email?.trim().toLowerCase();
  const isConfiguredAdmin = Boolean(adminEmail && signedInEmail === adminEmail);

  if (!isLoopback(ip) && !allowedIps.includes(ip) && !isConfiguredAdmin) {
    res.status(403).json({
      error:
        'Queue dashboard requires localhost access, an IP listed in DASHBOARD_ALLOWED_IPS, ' +
        'a signed-in ADMIN_EMAIL account, or ?token=<ADMIN_TOKEN>.',
    });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Dashboard factory & lifecycle
// ---------------------------------------------------------------------------

/**
 * Build the Bull Board router. Returns null if the dashboard should be
 * disabled (production without ADMIN_TOKEN).
 */
export function createQueueDashboard(customQueue?: Queue): Router | null {
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const adminToken = process.env.ADMIN_TOKEN;

  if (isProd && !adminToken) {
    console.warn(
      '[BullBoard] Dashboard disabled in production: set ADMIN_TOKEN env var to enable it.'
    );
    return null;
  }

  if (customQueue) {
    dashboardQueueInstance = customQueue;
  } else if (!dashboardQueueInstance) {
    const connection = parseRedisConnection(process.env.REDIS_URL || REDIS_URL);
    const queueName = process.env.EMAIL_QUEUE_NAME || EMAIL_QUEUE_NAME;
    dashboardQueueInstance = new Queue(queueName, { connection });
    dashboardQueueInstance.on('error', (err: Error) => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[BullBoard] Queue Redis connection error:', err.message);
      }
    });
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(DASHBOARD_BASE_PATH);

  createBullBoard({
    queues:        [new BullMQAdapter(dashboardQueueInstance)],
    serverAdapter,
  });

  // Wrap in an Express Router so we can apply the guard
  const wrapper = Router();
  wrapper.use(dashboardGuard);
  wrapper.use(serverAdapter.getRouter());
  return wrapper;
}

/**
 * Gracefully close the dashboard queue instance during application teardown or testing.
 */
export async function closeQueueDashboard(): Promise<void> {
  if (dashboardQueueInstance) {
    try {
      await dashboardQueueInstance.close();
    } catch {
      // ignore
    } finally {
      dashboardQueueInstance = null;
    }
  }
}
