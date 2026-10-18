/**
 * Worker Configuration — Milestone 4
 * Loads environment variables, validates required settings,
 * and rejects invalid/nonsensical values at startup.
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Load .env from monorepo root or cwd
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '../..', '.env'),
];

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`[Worker Config] Loaded .env from: ${envPath}`);
    break;
  }
}

export function required(key: string, env: Record<string, string | undefined> = process.env): string {
  const value = env[key];
  if (!value) throw new Error(`[Worker Config] Missing required environment variable: ${key}`);
  return value;
}

export function optional(key: string, fallback: string, env: Record<string, string | undefined> = process.env): string {
  return env[key] ?? fallback;
}

export function positiveInt(key: string, fallback: number, env: Record<string, string | undefined> = process.env): number {
  const raw = env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`[Worker Config] ${key} must be a non-negative integer. Got: '${raw}'`);
  }
  return parsed;
}

export function positiveIntRequired(key: string, fallback: number, env: Record<string, string | undefined> = process.env): number {
  const value = positiveInt(key, fallback, env);
  if (value <= 0 && env[key] !== undefined) {
    throw new Error(`[Worker Config] ${key} must be a positive integer. Got: '${env[key]}'`);
  }
  return value;
}

export function parseRateLimitScope(raw: string): 'global' | 'per-sender' {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'global' || normalized === 'per-sender') return normalized;
  throw new Error(
    `[Worker Config] RATE_LIMIT_SCOPE must be 'global' or 'per-sender'. Got: '${raw}'`
  );
}

// ── Build and validate config object ─────────────────────────────────────────

export const workerConfig = {
  NODE_ENV: optional('NODE_ENV', 'development'),
  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: optional('REDIS_URL', 'redis://localhost:6379'),
  WORKER_CONCURRENCY: positiveIntRequired('WORKER_CONCURRENCY', 5),

  // Ethereal SMTP — auto-created test credentials if not set
  SMTP_HOST: optional('SMTP_HOST', ''),
  SMTP_PORT: positiveInt('SMTP_PORT', 587),
  SMTP_USER: optional('SMTP_USER', ''),
  SMTP_PASS: optional('SMTP_PASS', ''),
  SMTP_FROM: optional('SMTP_FROM', 'ReachInbox <noreply@reachinbox.local>'),

  // Brevo HTTPS email API — used instead of SMTP when BREVO_API_KEY is set.
  // Works on hosts that block outbound SMTP (e.g. Render's free plan).
  BREVO_API_KEY: optional('BREVO_API_KEY', ''),
  /** Verified Brevo sender address; defaults to the Brevo account's email. */
  BREVO_SENDER_EMAIL: optional('BREVO_SENDER_EMAIL', ''),

  // ── Rate Limiting (Milestone 4) ──────────────────────────────────────────
  /** Maximum emails allowed per hourly window. 0 = unlimited. */
  RATE_LIMIT_MAX_PER_HOUR: positiveInt('RATE_LIMIT_MAX_PER_HOUR', 100),
  /** Minimum interval between consecutive sends, in milliseconds. 0 = no pacing. */
  RATE_LIMIT_INTERVAL_MS: positiveInt('RATE_LIMIT_INTERVAL_MS', 1000),
  /** Scope of the rate limit: 'global' (shared across all senders) or 'per-sender'. */
  RATE_LIMIT_SCOPE: parseRateLimitScope(optional('RATE_LIMIT_SCOPE', 'per-sender')),
  /** Redis key prefix for rate-limit counters. Prevents collisions with other apps. */
  RATE_LIMIT_KEY_PREFIX: optional('RATE_LIMIT_KEY_PREFIX', 'rl:reachinbox'),
} as const;

export function validateSmtpConfig(config: {
  NODE_ENV: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
}): void {
  if (config.SMTP_PORT < 1 || config.SMTP_PORT > 65535) {
    throw new Error(`[Worker Config] SMTP_PORT must be between 1 and 65535. Got: '${config.SMTP_PORT}'`);
  }

  const hasAnySmtp = Boolean(config.SMTP_HOST || config.SMTP_USER || config.SMTP_PASS);
  const hasFullSmtp = Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS);

  if (hasAnySmtp && !hasFullSmtp) {
    throw new Error(
      '[Worker Config] Partial SMTP configuration: SMTP_HOST, SMTP_USER, and SMTP_PASS must all be provided together.'
    );
  }

  // ALLOW_ETHEREAL=true opts a production deploy into the Ethereal fake inbox
  // (the API sets it for its embedded worker when no SMTP relay is configured).
  const hasBrevo = Boolean(process.env.BREVO_API_KEY);
  if (config.NODE_ENV === 'production' && !hasFullSmtp && !hasBrevo && process.env.ALLOW_ETHEREAL !== 'true') {
    throw new Error(
      '[Worker Config] Production environment requires real SMTP configuration (SMTP_HOST, SMTP_USER, SMTP_PASS) or BREVO_API_KEY. Ethereal fallback is disabled in production unless ALLOW_ETHEREAL=true.'
    );
  }

  if (!config.SMTP_FROM || config.SMTP_FROM.trim().length === 0) {
    throw new Error('[Worker Config] SMTP_FROM cannot be empty.');
  }
}

// ── Startup validation ──────────────────────────────────────────────────────

if (workerConfig.WORKER_CONCURRENCY < 1) {
  throw new Error('[Worker Config] WORKER_CONCURRENCY must be at least 1.');
}

if (workerConfig.RATE_LIMIT_MAX_PER_HOUR < 0) {
  throw new Error('[Worker Config] RATE_LIMIT_MAX_PER_HOUR cannot be negative.');
}

if (workerConfig.RATE_LIMIT_INTERVAL_MS < 0) {
  throw new Error('[Worker Config] RATE_LIMIT_INTERVAL_MS cannot be negative.');
}

validateSmtpConfig(workerConfig);

// Log config (no secrets)
console.log('[Worker Config] Rate limiting configuration:');
console.log(`  MAX_PER_HOUR:  ${workerConfig.RATE_LIMIT_MAX_PER_HOUR}`);
console.log(`  INTERVAL_MS:   ${workerConfig.RATE_LIMIT_INTERVAL_MS}`);
console.log(`  SCOPE:         ${workerConfig.RATE_LIMIT_SCOPE}`);
console.log(`  KEY_PREFIX:    ${workerConfig.RATE_LIMIT_KEY_PREFIX}`);
