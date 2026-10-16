/**
 * BullMQ Queue Client
 * Provides a singleton Queue instance for the email-jobs queue.
 */
import { Queue } from 'bullmq';
import { getRedisClient } from '../redis/client.js';
import type { EmailJobData } from './types.js';

export const EMAIL_QUEUE_NAME = 'email-jobs';

let emailQueue: Queue<EmailJobData> | null = null;

export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s initial backoff, then 10s, 20s
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 500,
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
          count: 1000,
        },
      },
    });

    emailQueue.on('error', (err: Error) => {
      console.error('[EmailQueue Error]', err.message);
    });
  }

  return emailQueue;
}

export async function closeEmailQueue(): Promise<void> {
  if (emailQueue) {
    try {
      await emailQueue.close();
      console.log('[EmailQueue] Queue connection closed.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EmailQueue] Error closing queue:', msg);
    } finally {
      emailQueue = null;
    }
  }
}
