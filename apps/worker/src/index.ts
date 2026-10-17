/**
 * ReachInbox Background Worker — Milestone 4
 *
 * Entry point: starts the BullMQ Worker that processes email-jobs queue.
 * Initialises the distributed rate limiter from the shared Redis connection.
 */
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { workerConfig } from './config.js';
import { closePrisma } from './prisma.js';
import {
  processEmailJob,
  initRateLimiter,
  RateLimitDeferralError,
  type EmailJobData,
} from './processor.js';

const EMAIL_QUEUE_NAME = 'email-jobs';
const EMAIL_JOB_NAME = 'send-email';

let worker: Worker<EmailJobData> | null = null;
let redisConnection: Redis | null = null;
let rateLimitRedisConnection: Redis | null = null;

function createRedisConnection(): Redis {
  const client = new Redis(workerConfig.REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 1000, 5000),
  });

  client.on('error', (err: Error) => {
    console.error('[Worker Redis]', err.message);
  });

  return client;
}

async function startWorker(): Promise<void> {
  console.log('=======================================================');
  console.log('🔧 ReachInbox Email Worker starting...');
  console.log(`📍 Environment: ${workerConfig.NODE_ENV}`);
  console.log(`🔗 Redis:       ${workerConfig.REDIS_URL}`);
  console.log(`⚡ Concurrency: ${workerConfig.WORKER_CONCURRENCY}`);
  console.log(`🚦 Rate limit:  ${workerConfig.RATE_LIMIT_MAX_PER_HOUR}/hr, `
    + `${workerConfig.RATE_LIMIT_INTERVAL_MS}ms interval, `
    + `scope=${workerConfig.RATE_LIMIT_SCOPE}`);
  console.log('=======================================================');

  redisConnection = createRedisConnection();

  // Initialise the distributed rate limiter with a dedicated connection
  rateLimitRedisConnection = createRedisConnection();
  initRateLimiter(rateLimitRedisConnection);
  console.log('[Worker] ✅ Distributed rate limiter initialised.');

  worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>, token?: string) => {
      if (job.name !== EMAIL_JOB_NAME) {
        console.warn(`[Worker] Unknown job name '${job.name}', skipping.`);
        return;
      }
      await processEmailJob(job, token);
    },
    {
      connection: redisConnection,
      concurrency: workerConfig.WORKER_CONCURRENCY,
      // Stalled job detection: if a job hasn't reported progress in 30s, consider it stalled
      stalledInterval: 30000,
      maxStalledCount: 2,
    }
  );

  worker.on('completed', (job: Job<EmailJobData>) => {
    console.log(`[Worker] ✅ Job ${job.id} completed for email ${job.data.emailId}`);
  });

  worker.on('failed', (job: Job<EmailJobData> | undefined, err: Error) => {
    const emailId = job?.data.emailId ?? 'unknown';
    // Don't log rate-limit deferrals as failures — they're expected
    if (err instanceof RateLimitDeferralError) {
      console.log(`[Worker] ⏳ Job ${job?.id ?? '?'} deferred for email ${emailId}: ${err.reason}`);
    } else {
      console.error(`[Worker] ❌ Job ${job?.id ?? '?'} failed for email ${emailId}: ${err.message}`);
    }
  });

  worker.on('stalled', (jobId: string) => {
    console.warn(`[Worker] ⚠️  Job ${jobId} stalled and will be retried.`);
  });

  worker.on('error', (err: Error) => {
    console.error('[Worker] Worker error:', err.message);
  });

  console.log(`[Worker] 🎯 Listening on queue '${EMAIL_QUEUE_NAME}'...`);
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n[Worker] Received ${signal}. Shutting down gracefully...`);

  const timeout = setTimeout(() => {
    console.error('[Worker] Force shutdown after 15s timeout.');
    process.exit(1);
  }, 15000);

  try {
    if (worker) {
      await worker.close();
      console.log('[Worker] BullMQ Worker closed.');
    }
    await closePrisma();
    if (redisConnection) {
      await redisConnection.quit().catch(() => {});
      console.log('[Worker] Redis connection closed.');
    }
    if (rateLimitRedisConnection) {
      await rateLimitRedisConnection.quit().catch(() => {});
      console.log('[Worker] Rate limiter Redis connection closed.');
    }
    clearTimeout(timeout);
    console.log('[Worker] Shutdown complete.');
    process.exit(0);
  } catch (err: unknown) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Error during shutdown:', msg);
    process.exit(1);
  }
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err: Error) => {
  console.error('[Worker] Uncaught exception:', err.message);
  void gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Worker] Unhandled rejection:', reason);
  void gracefulShutdown('unhandledRejection');
});

void startWorker();
