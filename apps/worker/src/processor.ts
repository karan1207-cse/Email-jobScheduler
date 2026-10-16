/**
 * BullMQ Job Processor — Milestone 4
 *
 * Handles the 'send-email' job with rate limiting and pacing:
 *
 * 1. Fetch email from DB → guard against NOT_FOUND / CANCELLED / SENT
 * 2. Mark email as PROCESSING
 * 3. Check distributed rate limiter (hourly limit + pacing interval)
 *    - If DENIED: revert to SCHEDULED, move job to delayed, return (no throw)
 * 4. Send via SMTP
 * 5. Mark as SENT + create outbox event
 * 6. On SMTP failure: SCHEDULED (retry) or FAILED (final) + throw to trigger BullMQ retry
 *
 * Rate-limit deferrals do NOT consume BullMQ retry attempts.
 * Redis failures are treated as transient errors — no unregulated sending.
 */
import { type Job, DelayedError } from 'bullmq';
import { getPrisma } from './prisma.js';
import { sendEmail } from './mailer.js';
import { DistributedRateLimiter } from './rate-limiter.js';
import type { Redis } from 'ioredis';

export interface EmailJobData {
  emailId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledTime: string;
}

/**
 * Sentinel error class for rate-limit deferrals.
 * Extends BullMQ's DelayedError so that BullMQ recognizes the job was moved
 * to the delayed state, skips moveToFailed, skips emitting 'failed', and does
 * NOT consume a retry attempt.
 */
export class RateLimitDeferralError extends DelayedError {
  constructor(
    public readonly retryAfterMs: number,
    public readonly reason: string
  ) {
    super(`Rate limited: ${reason}`);
    this.name = 'DelayedError';
  }
}

let limiter: DistributedRateLimiter | null = null;

export function initRateLimiter(redis: Redis | null): void {
  limiter = redis ? new DistributedRateLimiter(redis) : null;
}

export function getRateLimiter(): DistributedRateLimiter | null {
  return limiter;
}

/**
 * Core processor function — called by BullMQ Worker for each job.
 * Must throw to trigger a retry; must return normally to mark job complete.
 * Rate-limit deferrals return normally after rescheduling (no retry consumed).
 */
export async function processEmailJob(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId, recipient, subject, body } = job.data;
  const prisma = getPrisma();
  const lockToken = token ?? job.token;

  console.log(
    `[Worker] Processing job ${job.id} | emailId=${emailId} | attempt=${job.attemptsMade + 1}`
  );

  // 1. Fetch the latest email state from DB
  const email = await prisma.email.findUnique({ where: { id: emailId } });

  if (!email) {
    console.warn(`[Worker] Email ${emailId} not found. Discarding job.`);
    return;
  }

  if (email.status === 'CANCELLED') {
    console.log(`[Worker] Email ${emailId} was CANCELLED. Discarding job.`);
    return;
  }

  if (email.status === 'SENT') {
    console.log(`[Worker] Email ${emailId} already SENT. Skipping.`);
    return;
  }

  const initialAttemptCount = Math.max(0, email.attemptCount);

  // 2. Mark as PROCESSING and increment attempt counter
  await prisma.email.update({
    where: { id: emailId },
    data: {
      status: 'PROCESSING',
      attemptCount: { increment: 1 },
    },
  });

  // 3. Check distributed rate limiter (if initialised)
  if (limiter) {
    try {
      const result = await limiter.acquireSendSlot(email.userId);

      if (!result.allowed) {
        // Rate limited — revert to SCHEDULED and defer the job
        console.log(
          `[Worker] ⏳ Rate limited email ${emailId}: ${result.reason} ` +
          `Deferring for ${result.retryAfterMs}ms.`
        );

        // Revert PROCESSING → SCHEDULED and restore the initial attempt count
        await prisma.email.update({
          where: { id: emailId },
          data: {
            status: 'SCHEDULED',
            attemptCount: initialAttemptCount,
          },
        });

        // Move job to delayed state — does NOT consume a BullMQ retry attempt
        await job.moveToDelayed(Date.now() + result.retryAfterMs, lockToken);

        // Throw DelayedError so BullMQ recognizes this job as delayed, skips moveToFailed,
        // and does NOT consume an attempt count.
        throw new RateLimitDeferralError(result.retryAfterMs, result.reason ?? 'Rate limited');
      }
    } catch (err: unknown) {
      if (err instanceof RateLimitDeferralError) {
        throw err; // Propagate to BullMQ — job is already moved to delayed
      }
      // Redis failure — treat as transient error, DO NOT bypass rate limiting
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Worker] ❌ Rate limiter error for email ${emailId}: ${errMsg}`);

      // Revert PROCESSING → SCHEDULED and restore initial attempt count
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'SCHEDULED',
          attemptCount: initialAttemptCount,
          lastError: `Rate limiter unavailable: ${errMsg.slice(0, 500)}`,
        },
      });

      // Re-throw so BullMQ retries with normal backoff
      throw err;
    }
  }

  try {
    // 4. Build HTML body
    const htmlBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">${subject}</h2>
        <div style="color: #374151; line-height: 1.6;">${body.replace(/\n/g, '<br/>')}</div>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 12px;">Sent via ReachInbox Email Scheduler</p>
      </div>`;

    // 5. Send via SMTP (Ethereal in dev, real SMTP in prod)
    const result = await sendEmail({
      to: recipient,
      subject,
      html: htmlBody,
    });

    // 6. Mark as SENT with timestamp
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        lastError: null,
      },
    });

    console.log(
      `[Worker] ✅ Email ${emailId} sent successfully. messageId=${result.messageId}` +
      (result.previewUrl ? ` preview=${result.previewUrl}` : '')
    );

    // 7. Record successful outbox event
    await prisma.outboxEvent.create({
      data: {
        eventType: 'EMAIL_SENT',
        aggregateId: emailId,
        payload: {
          emailId,
          recipient,
          messageId: result.messageId,
          previewUrl: result.previewUrl,
          sentAt: new Date().toISOString(),
        },
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Worker] ❌ Failed to send email ${emailId}: ${errMsg}`);

    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    // Update DB — FAILED on last attempt, back to SCHEDULED for retry
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: isLastAttempt ? 'FAILED' : 'SCHEDULED',
        lastError: errMsg.slice(0, 1000),
      },
    });

    if (isLastAttempt) {
      await prisma.outboxEvent.create({
        data: {
          eventType: 'EMAIL_FAILED',
          aggregateId: emailId,
          payload: { emailId, recipient, error: errMsg.slice(0, 1000) },
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });
      console.error(`[Worker] 💀 Email ${emailId} moved to FAILED after exhausting all retries.`);
    }

    // Re-throw to let BullMQ handle retry/backoff
    throw err;
  }
}
