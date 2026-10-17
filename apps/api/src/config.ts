import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Attempt loading .env from several possible locations (cwd, root of monorepo, or apps/api parent)
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
];

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

export interface AppConfig {
  NODE_ENV: string;
  PORT: number;
  FRONTEND_URL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  // Google OAuth (Milestone 6) — optional in development
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  // Session (Milestone 6)
  SESSION_SECRET: string;
}

export function loadConfig(): AppConfig {
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const rawPort = process.env.PORT || '5000';
  const PORT = parseInt(rawPort, 10);

  if (Number.isNaN(PORT) || PORT <= 0 || PORT > 65535) {
    throw new Error(`Invalid PORT configuration: "${rawPort}". Must be a valid TCP port number between 1 and 65535.`);
  }

  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://reachinbox:reachinbox_secret@localhost:5432/reachinbox_db';
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  if (!REDIS_URL) {
    throw new Error('REDIS_URL environment variable is required.');
  }

  // Google OAuth — warn in development, not fatal (routes return 503 without credentials)
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
  const GOOGLE_REDIRECT_URI =
    process.env.GOOGLE_REDIRECT_URI ||
    `http://localhost:${parseInt(process.env.PORT || '5000', 10)}/auth/google/callback`;

  if (NODE_ENV === 'production' && (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production.');
  }

  // Session secret — must be set in production; defaults to random in development
  const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    (NODE_ENV === 'production'
      ? (() => { throw new Error('SESSION_SECRET is required in production.'); })()
      : 'dev-session-secret-NOT-FOR-PRODUCTION');

  return {
    NODE_ENV,
    PORT,
    FRONTEND_URL,
    DATABASE_URL,
    REDIS_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    SESSION_SECRET,
  };
}

export const config = loadConfig();
