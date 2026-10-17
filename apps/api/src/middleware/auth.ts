/**
 * Session and Authentication Middleware — Milestone 6
 *
 * Provides:
 * - requireAuth: Guard middleware for protected routes
 * - getCurrentUser: Extracts the authenticated user from session
 *
 * Session shape: { userId, email, displayName, picture }
 * Sessions are stored server-side. Only a session ID cookie is sent to the client.
 */
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { DEV_DEFAULT_USER } from '../services/email.service.js';

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
  picture?: string;
}

// Augment the express-session Session type
declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    oauthState?: string;
  }
}

/**
 * Middleware: Require an authenticated session.
 * - Requires an authenticated session outside tests, else HTTP 401.
 * - In test environment: respects `x-test-user-id` header for easy user switching in tests.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.user?.userId) {
    return next();
  }

  // Header-based test user simulation for multi-user tests in test/dev
  const testUserId = req.header('x-test-user-id');
  if (testUserId && config.NODE_ENV === 'test') {
    if (!req.session) {
      (req as unknown as { session: Record<string, unknown> }).session = {};
    }
    req.session.user = {
      userId: testUserId,
      email: `${testUserId}@reachinbox.test`,
      displayName: `Test User (${testUserId})`,
    };
    return next();
  }

  // Unit tests that exercise protected routes without OAuth get an isolated
  // fixture identity. This branch is unreachable in development/production.
  if (config.NODE_ENV === 'test') {
    if (!req.session) {
      (req as unknown as { session: Record<string, unknown> }).session = {};
    }
    req.session.user = {
      userId: DEV_DEFAULT_USER.id,
      email: DEV_DEFAULT_USER.email,
      displayName: DEV_DEFAULT_USER.displayName,
    };
    return next();
  }

  res.status(401).json({
    error: {
      message: 'Authentication required. Please sign in with Google.',
      status: 401,
    },
  });
}

/**
 * Returns the authenticated user from the request session.
 * Call only after requireAuth middleware has validated the session.
 */
export function getCurrentUser(req: Request): SessionUser {
  const user = req.session?.user;
  if (!user) {
    throw new Error('getCurrentUser called without authenticated session.');
  }
  return user;
}
