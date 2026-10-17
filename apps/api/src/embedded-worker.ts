/**
 * Embedded email worker.
 *
 * Hosts without a separate background-worker service (for example Render's
 * free plan) can run the BullMQ worker as a child process of the API. It is
 * on by default on Render (RENDER=true) and can be forced with
 * RUN_WORKER_IN_API=true or turned off with RUN_WORKER_IN_API=false.
 *
 * The worker keeps its own process so its signal handling and exits stay
 * separate from the API; it is restarted with back-off if it dies, and its
 * status is reported on /health.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface EmbeddedWorkerStatus {
  enabled: boolean;
  state: 'disabled' | 'missing' | 'starting' | 'running' | 'restarting' | 'stopped';
  pid: number | null;
  restarts: number;
  lastExit: string | null;
  recentErrors: string[];
}

const MAX_RECENT_ERRORS = 10;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

const status: EmbeddedWorkerStatus = {
  enabled: false,
  state: 'disabled',
  pid: null,
  restarts: 0,
  lastExit: null,
  recentErrors: [],
};

let child: ChildProcess | null = null;
let stopping = false;
let backoffMs = MIN_BACKOFF_MS;
let restartTimer: NodeJS.Timeout | null = null;

export function isEmbeddedWorkerEnabled(): boolean {
  const flag = process.env.RUN_WORKER_IN_API?.toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.RENDER === 'true';
}

export function getEmbeddedWorkerStatus(): EmbeddedWorkerStatus {
  return { ...status, recentErrors: [...status.recentErrors] };
}

function rememberError(line: string): void {
  status.recentErrors.push(line.slice(0, 500));
  if (status.recentErrors.length > MAX_RECENT_ERRORS) status.recentErrors.shift();
}

function workerEntry(): string {
  // dist/embedded-worker.js → apps/api/dist → apps/worker/dist/index.js
  return process.env.WORKER_ENTRY || path.resolve(__dirname, '../../worker/dist/index.js');
}

function launch(): void {
  const entry = workerEntry();
  if (!fs.existsSync(entry)) {
    status.state = 'missing';
    rememberError(`Worker build not found at ${entry}. Build it with "npm run build --workspace=@reachinbox/worker".`);
    console.error(`[EmbeddedWorker] ${status.recentErrors[status.recentErrors.length - 1]}`);
    return;
  }

  const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  status.state = 'starting';
  child = spawn(process.execPath, [entry], {
    cwd: path.dirname(path.dirname(entry)),
    env: {
      ...process.env,
      // Without a real SMTP relay the worker delivers to Ethereal (fake SMTP),
      // which it otherwise refuses in production.
      ...(hasSmtp ? {} : { ALLOW_ETHEREAL: 'true' }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  status.pid = child.pid ?? null;

  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      console.log(`[worker] ${line}`);
      if (line.includes('Listening on queue')) {
        status.state = 'running';
        backoffMs = MIN_BACKOFF_MS;
      }
    }
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      console.error(`[worker] ${line}`);
      rememberError(line);
    }
  });

  child.on('exit', (code, signal) => {
    child = null;
    status.pid = null;
    status.lastExit = `${new Date().toISOString()} code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    if (stopping) {
      status.state = 'stopped';
      return;
    }
    status.state = 'restarting';
    status.restarts += 1;
    console.error(`[EmbeddedWorker] Worker exited (${status.lastExit}); restarting in ${backoffMs / 1000}s.`);
    restartTimer = setTimeout(launch, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  });
}

export function startEmbeddedWorker(): void {
  if (!isEmbeddedWorkerEnabled() || child) return;
  status.enabled = true;
  stopping = false;
  console.log('[EmbeddedWorker] Starting the email worker inside the API process.');
  launch();
}

export async function stopEmbeddedWorker(): Promise<void> {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  const proc = child;
  if (!proc) return;
  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => proc.kill('SIGKILL'), 8_000);
    proc.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}
