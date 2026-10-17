/**
 * BullMQ Queue Dashboard — Milestone 9
 *
 * Creates the Bull Board Express adapter and exports the router plus a
 * guard middleware for mounting in app.ts.
 *
 * Security model:
 * - Development (NODE_ENV !== 'production'): localhost-only access.
 * - Production: requires X-Admin-Token header matching ADMIN_TOKEN env var.
 *   If ADMIN_TOKEN is not set in production, the dashboard is disabled entirely.
 */

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

function parseRedisConnection(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host:     parsed.hostname || 'localhost',
      port:     parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    };
  } catch {
    return {
      host: 'localhost',
      port: 6379,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    };
  }
}

// ---------------------------------------------------------------------------
// Guard middleware
// ---------------------------------------------------------------------------

/**
 * Protect the dashboard:
 * - In development: localhost only.
 * - In production: valid X-Admin-Token header required.
 */
export function dashboardGuard(req: Request, res: Response, next: NextFunction): void {
  const adminToken = process.env.ADMIN_TOKEN;
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (isProd) {
    const provided = (req.headers['x-admin-token'] as string | undefined) ?? '';
    if (!adminToken || provided !== adminToken) {
      res.status(403).json({ error: 'Forbidden: invalid or missing admin token.' });
      return;
    }
  } else {
    const ip      = req.ip ?? req.socket.remoteAddress ?? '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) {
      res.status(403).json({
        error: 'Queue dashboard is only accessible from localhost in development.',
      });
      return;
    }
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
