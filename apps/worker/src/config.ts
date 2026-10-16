/**
 * Worker Configuration
 * Loads environment variables and validates required settings.
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

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`[Worker Config] Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const workerConfig = {
  NODE_ENV: optional('NODE_ENV', 'development'),
  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: optional('REDIS_URL', 'redis://localhost:6379'),
  WORKER_CONCURRENCY: parseInt(optional('WORKER_CONCURRENCY', '5'), 10),

  // Ethereal SMTP — auto-created test credentials if not set
  SMTP_HOST: optional('SMTP_HOST', ''),
  SMTP_PORT: parseInt(optional('SMTP_PORT', '587'), 10),
  SMTP_USER: optional('SMTP_USER', ''),
  SMTP_PASS: optional('SMTP_PASS', ''),
  SMTP_FROM: optional('SMTP_FROM', 'ReachInbox <noreply@reachinbox.local>'),
} as const;
