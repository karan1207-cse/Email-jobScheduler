/**
 * Google OAuth Integration — Milestone 6
 *
 * Provides:
 * - OAuth2Client for Google Sign-In ID token verification
 * - Authorization URL generation for the server-side OAuth flow
 * - Token exchange (auth code -> access/id tokens)
 * - User info extraction from verified ID token claims
 *
 * SECURITY NOTES:
 * - Client secret is never returned to the frontend
 * - ID tokens are verified server-side using Google's public certs
 * - State parameter prevents CSRF on the OAuth callback
 */
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

let client: OAuth2Client | null = null;

export function getOAuthClient(): OAuth2Client {
  if (!client) {
    client = new OAuth2Client(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI
    );
  }
  return client;
}

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  displayName: string;
  picture?: string;
}

/**
 * Generate the Google authorization URL with required scopes.
 * The state parameter is used for CSRF protection.
 */
export function getAuthorizationUrl(state: string): string {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  });
}

/**
 * Exchange an authorization code for tokens, then verify and extract user info.
 * Returns structured GoogleUserInfo on success.
 * Throws on invalid or expired tokens.
 */
export async function exchangeCodeForUser(code: string): Promise<GoogleUserInfo> {
  const oauth2Client = getOAuthClient();

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (!tokens.id_token) {
    throw new Error('Google OAuth: No ID token returned from token exchange.');
  }

  // Verify ID token against Google's public keys
  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Google OAuth: Invalid ID token payload — missing required claims.');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    displayName: payload.name || payload.email,
    picture: payload.picture,
  };
}
