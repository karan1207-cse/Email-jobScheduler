/**
 * Auth Routes — Milestone 6
 *
 * GET  /auth/google          → Redirect to Google OAuth consent page
 * GET  /auth/google/callback → Handle OAuth callback, create session, redirect to frontend
 * GET  /auth/me              → Return current authenticated user profile
 * POST /auth/logout          → Destroy session and clear cookie
 *
 * SECURITY:
 * - State parameter prevents CSRF on the OAuth callback
 * - Sessions use HTTP-only, SameSite=Lax cookies
 * - Client secret is never exposed to frontend
 * - Redirect URL is validated against configured allowlist
 */
import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { getAuthorizationUrl, exchangeCodeForUser } from '../auth/google.js';
import { requireAuth, getCurrentUser } from '../middleware/auth.js';
import { getPrismaClient } from '../db/prisma.js';
import { config } from '../config.js';

export const authRouter = Router();

/**
 * GET /auth/google
 * Redirect the browser to Google's OAuth consent screen.
 * The state token is stored in session for CSRF validation on callback.
 */
authRouter.get('/auth/google', (req: Request, res: Response): void => {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    res.status(503).json({
      error: {
        message: 'Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        status: 503,
      },
    });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  if (!req.session) {
    (req as unknown as { session: Record<string, unknown> }).session = {};
  }
  req.session.oauthState = state;

  const authUrl = getAuthorizationUrl(state);
  res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 * Google redirects here after user grants consent.
 * Validates state, exchanges code for tokens, upserts user, creates session.
 */
authRouter.get('/auth/google/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  // Handle user denial or OAuth error
  if (error) {
    console.warn(`[Auth] Google OAuth error: ${error}`);
    res.redirect(`${config.FRONTEND_URL}?auth_error=${encodeURIComponent(error)}`);
    return;
  }

  // CSRF state validation
  const expectedState = req.session?.oauthState;
  if (!state || state !== expectedState) {
    console.warn('[Auth] OAuth state mismatch — possible CSRF attempt.');
    res.redirect(`${config.FRONTEND_URL}?auth_error=state_mismatch`);
    return;
  }

  // Clear the one-time state token
  if (req.session) {
    delete req.session.oauthState;
  }

  if (!code) {
    res.redirect(`${config.FRONTEND_URL}?auth_error=missing_code`);
    return;
  }

  try {
    const googleUser = await exchangeCodeForUser(code);
    const prisma = getPrismaClient();

    // Upsert the user in our database (find by googleId / email)
    const dbUser = await prisma.user.upsert({
      where: { email: googleUser.email },
      update: {
        displayName: googleUser.displayName,
        providerId: googleUser.googleId,
      },
      create: {
        email: googleUser.email,
        displayName: googleUser.displayName,
        providerId: googleUser.googleId,
      },
    });

    // Establish authenticated session
    if (!req.session) {
      (req as unknown as { session: Record<string, unknown> }).session = {};
    }
    req.session.user = {
      userId: dbUser.id,
      email: dbUser.email,
      displayName: dbUser.displayName ?? googleUser.displayName,
      picture: googleUser.picture,
    };

    console.log(`[Auth] User signed in: ${dbUser.email} (id=${dbUser.id})`);
    res.redirect(`${config.FRONTEND_URL}?auth_success=1`);
    return;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Auth] OAuth callback error: ${msg}`);
    res.redirect(`${config.FRONTEND_URL}?auth_error=server_error`);
    return;
  }
});

/**
 * GET /auth/me
 * Returns the current authenticated user's profile.
 * Protected: requires valid session.
 */
authRouter.get('/auth/me', requireAuth, (req: Request, res: Response): void => {
  const user = getCurrentUser(req);
  res.json({
    id: user.userId,
    email: user.email,
    displayName: user.displayName,
    picture: user.picture ?? null,
  });
});

/**
 * POST /auth/logout
 * Destroys the server-side session and clears the session cookie.
 */
authRouter.post('/auth/logout', (req: Request, res: Response): void => {
  const email = req.session?.user?.email ?? 'unknown';
  if (!req.session) {
    res.clearCookie('reachinbox.sid');
    res.json({ success: true, message: 'Signed out successfully.' });
    return;
  }

  req.session.destroy((err) => {
    if (err) {
      console.error(`[Auth] Session destroy error for ${email}: ${err}`);
      res.status(500).json({
        error: { message: 'Failed to destroy session.', status: 500 },
      });
      return;
    }
    res.clearCookie('reachinbox.sid');
    console.log(`[Auth] User signed out: ${email}`);
    res.json({ success: true, message: 'Signed out successfully.' });
  });
});
