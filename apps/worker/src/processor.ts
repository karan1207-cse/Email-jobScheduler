/**
 * BullMQ Job Processor — Milestone 5 (Email Delivery Reliability)
 *
 * Handles the 'send-email' job with delivery resilience:
 *
 * 1. Fetch email from DB → guard against NOT_FOUND / CANCELLED / SENT
 * 2. Mark email as PROCESSING with initial attempt count tracking
 * 3. Check distributed rate limiter (hourly limit + pacing interval)
 *    - If DENIED: revert to SCHEDULED, move job to delayed via DelayedError
 * 4. Pre-send cancellation check: ensure status is still active before SMTP
 * 5. Send via SMTP (multipart MIME HTML + plain-text)
 * 6. Distinguish SMTP acceptance from post-send DB persistence
 *    - On SMTP failure: SCHEDULED (retry) or FAILED (final) + BullMQ backoff
 *    - On post-send DB failure: Localized retry up to 3x, never blind duplicate send
 * 7. Ethereal preview URLs cleanly logged without credentials or sensitive data
 */
import { type Job, DelayedError } from 'bullmq';
import { getPrisma } from './prisma.js';
import { sendEmail, type SendResult } from './mailer.js';
import { DistributedRateLimiter } from './rate-limiter.js';
import { dispatchRateLimitAlert } from './slack-alert.js';
import { indexEmailDoc } from './es-indexer.js';
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

/**
 * Sentinel error class for active lease deferrals.
 * Extends BullMQ's DelayedError so that BullMQ recognizes the job was moved
 * to the delayed state, skips moveToFailed, skips emitting 'failed', and does
 * NOT consume a retry attempt.
 */
export class ActiveLeaseDeferralError extends DelayedError {
  constructor(
    public readonly retryAfterMs: number,
    public readonly emailId: string
  ) {
    super(`Active lease held by another worker for email ${emailId}`);
    this.name = 'DelayedError';
  }
}

/**
 * Thrown when SMTP accepts a message, but post-send database updates fail
 * after localized retries. Prevents blind resending while preserving diagnostics.
 */
export class PostSendDatabaseError extends Error {
  constructor(public readonly messageId: string, message: string) {
    super(`SMTP accepted message (${messageId}), but DB persistence failed: ${message}`);
    this.name = 'PostSendDatabaseError';
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
 * Persists SENT state and EMAIL_SENT outbox event with localized retries.
 * Prevents transient PostgreSQL blips from marking the email for duplicate SMTP delivery.
 */
export async function persistSentStateWithRetry(
  prisma: ReturnType<typeof getPrisma>,
  emailId: string,
  recipient: string,
  result: SendResult,
  maxRetries = 3
): Promise<void> {
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. Atomic conditional update: only mark SENT if STILL in PROCESSING
      // Prevents a stale worker whose lease expired from overwriting FAILED or CANCELLED
      const updateResult = await prisma.email.updateMany({
        where: { id: emailId, status: 'PROCESSING' },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          lastError: null,
        },
      });

      if (updateResult.count === 0) {
        // The worker lost ownership while the SMTP send was in flight!
        // (e.g. Worker B quarantined the email as FAILED due to lease timeout,
        // or the email was cancelled / modified concurrently).
        const current = await prisma.email.findUnique({ where: { id: emailId } });
        const currentStatus = current?.status ?? 'UNKNOWN';

        console.error(
          `[Worker] ⚠️ CRITICAL CONCURRENCY DETECTED: Email ${emailId} was accepted by SMTP ` +
          `(messageId=${result.messageId}), but worker lost PROCESSING ownership ` +
          `(current status: '${currentStatus}'). Refusing to overwrite state with SENT.`
        );

        // Preserve SMTP acceptance details without overwriting FAILED or CANCELLED status.
        // Update lastError to provide full operator diagnostic and messageId for recovery.
        const recoveryMessage =
          `[AMBIGUOUS_DELIVERY_STALE_WORKER] SMTP accepted message (${result.messageId}), ` +
          `but worker lease expired or lost ownership before persistence. Status remains '${currentStatus}'. ` +
          `Operator recovery required. Prior error: ${current?.lastError ?? 'none'}`;

        try {
          await prisma.email.update({
            where: { id: emailId },
            data: {
              lastError: recoveryMessage.slice(0, 1000),
            },
          });
        } catch {
          // Best-effort error annotation
        }

        // Record outbox event for audit trail with the SMTP messageId
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
              ambiguousOutcome: true,
              priorStatus: currentStatus,
              note: 'Worker lost PROCESSING ownership before persistence. Message accepted by SMTP.',
            },
            status: 'PROCESSED',
            processedAt: new Date(),
          },
        });

        return; // Handled safely — do not retry, do not throw, state preserved with messageId
      }

      // Normal path: Worker retained ownership. Record outbox event.
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

      // Best-effort ES re-index to reflect SENT status
      const sentEmail = await prisma.email.findUnique({ where: { id: emailId } });
      if (sentEmail) {
        indexEmailDoc({
          id:            sentEmail.id,
          userId:        sentEmail.userId,
          recipient:     sentEmail.recipient,
          subject:       sentEmail.subject,
          body:          sentEmail.body,
          status:        sentEmail.status,
          scheduledTime: sentEmail.scheduledTime?.toISOString() ?? null,
          sentAt:        sentEmail.sentAt?.toISOString() ?? null,
          createdAt:     sentEmail.createdAt.toISOString(),
          updatedAt:     sentEmail.updatedAt.toISOString(),
          attemptCount:  sentEmail.attemptCount,
          lastError:     sentEmail.lastError ?? null,
        }).catch(() => {});
      }

      return; // Successfully persisted
    } catch (err: unknown) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
      }
    }
  }

  const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.error(
    `[Worker] ⚠️ CRITICAL: Email ${emailId} was accepted by SMTP (${result.messageId}), ` +
    `but database persistence failed after ${maxRetries} retries: ${errMsg}`
  );

  try {
    await prisma.email.update({
      where: { id: emailId },
      data: {
        lastError: `[SMTP_ACCEPTED_DB_ERROR] messageId=${result.messageId}: ${errMsg.slice(0, 800)}`,
      },
    });
  } catch {
    // Best-effort diagnostic record
  }

  throw new PostSendDatabaseError(result.messageId, errMsg);
}

/**
 * Handles SMTP delivery failures, transitioning to SCHEDULED (for retry) or FAILED (final).
 */
async function handleSmtpFailure(
  prisma: ReturnType<typeof getPrisma>,
  emailId: string,
  recipient: string,
  job: Job<EmailJobData>,
  err: unknown
): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`[Worker] ❌ Failed to send email ${emailId}: ${errMsg}`);

  const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

  // Conditional update: only update if STILL in PROCESSING
  // Prevents overwriting CANCELLED or SENT states
  const failureResult = await prisma.email.updateMany({
    where: { id: emailId, status: 'PROCESSING' },
    data: {
      status: isLastAttempt ? 'FAILED' : 'SCHEDULED',
      lastError: errMsg.slice(0, 1000),
    },
  });

  if (failureResult.count === 0) {
    console.log(`[Worker] Email ${emailId} was cancelled or completed concurrently. Ignoring SMTP failure.`);
    return;
  }

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
}

/**
 * Lease duration (in ms) during which an email in PROCESSING is considered owned
 * by an active worker. Default: 60 seconds.
 */
export const PROCESSING_LEASE_MS = 60_000;

/**
 * Core processor function — called by BullMQ Worker for each job.
 */
export async function processEmailJob(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId, recipient, subject, body } = job.data;
  const prisma = getPrisma();
  const lockToken = token ?? job.token;

  console.log(
    `[Worker] Processing job ${job.id} | emailId=${emailId} | attempt=${job.attemptsMade + 1}`
  );

  // 1. Atomic conditional claim: transition from SCHEDULED -> PROCESSING
  // In PostgreSQL, updateMany with where: { id, status: 'SCHEDULED' } executes an atomic
  // row-level lock and update. Exactly one worker will match and receive count === 1.
  const claimResult = await prisma.email.updateMany({
    where: { id: emailId, status: 'SCHEDULED' },
    data: {
      status: 'PROCESSING',
      attemptCount: { increment: 1 },
    },
  });

  let email: {
    id: string;
    userId: string;
    recipient: string;
    subject: string;
    body: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    updatedAt: Date;
  } | null = null;

  if (claimResult.count === 0) {
    // This worker lost the atomic claim race or the email is in an active/terminal state.
    // Must NOT proceed to SMTP. Inspect state to determine correct action.
    email = await prisma.email.findUnique({ where: { id: emailId } });

    if (!email) {
      console.warn(`[Worker] Email ${emailId} not found. Discarding job.`);
      return;
    }

    if (email.status === 'CANCELLED') {
      console.log(`[Worker] Email ${emailId} was CANCELLED. Discarding job.`);
      return;
    }

    if (email.status === 'SENT') {
      console.log(`[Worker] Email ${emailId} already SENT. Skipping (idempotent).`);
      return;
    }

    if (email.status === 'FAILED') {
      console.log(`[Worker] Email ${emailId} is FAILED. Discarding job.`);
      return;
    }

    if (email.status === 'PROCESSING') {
      // Determine whether this PROCESSING state represents:
      // 1. A demonstrably crashed attempt (retry attempt or SMTP accepted DB error)
      // 2. An expired lease (prior worker died/crashed > PROCESSING_LEASE_MS ago)
      // 3. A live active worker currently processing the email
      const isDemonstrablyCrashedRetry =
        job.attemptsMade > 0 ||
        (email.lastError?.includes('[SMTP_ACCEPTED_DB_ERROR]') ?? false);

      const leaseAgeMs = email.updatedAt
        ? Date.now() - new Date(email.updatedAt).getTime()
        : Infinity;
      const isLeaseExpired = leaseAgeMs >= PROCESSING_LEASE_MS;

      if (isDemonstrablyCrashedRetry || isLeaseExpired) {
        console.error(
          `[Worker] 🚫 Email ${emailId} is stuck in PROCESSING state ` +
          `(${isDemonstrablyCrashedRetry ? 'retry detected' : `lease expired: ${leaseAgeMs}ms`}). ` +
          `Refusing duplicate send to prevent multiple deliveries.`
        );
        // Conditional quarantine: only update if STILL in PROCESSING
        const quarantineResult = await prisma.email.updateMany({
          where: { id: emailId, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            lastError: `[POST_SEND_QUARANTINE] Prior attempt may have delivered the email. ` +
              `Refusing duplicate send. Check prior lastError for SMTP messageId. ` +
              `Operator must verify delivery and manually set status to SENT or SCHEDULED.`,
          },
        });
        if (quarantineResult.count === 0) {
          console.log(`[Worker] Email ${emailId} state transitioned concurrently during quarantine. Yielding.`);
        }
        return;
      }

      // Active worker currently owns this email with an active lease.
      // Defer the duplicate job via moveToDelayed so that:
      // 1. It is NOT marked successfully completed while delivery is in-progress (Requirement 2)
      // 2. It does NOT consume retry attempts or fail permanently (DelayedError contract, Requirement 3)
      const deferMs = Math.min(5_000, Math.max(1_000, PROCESSING_LEASE_MS - leaseAgeMs));
      console.log(
        `[Worker] ⏳ Email ${emailId} is currently being processed by another active worker ` +
        `(lease active, age ${leaseAgeMs}ms). Deferring duplicate job for ${deferMs}ms without failing.`
      );
      await job.moveToDelayed(Date.now() + deferMs, lockToken);
      throw new ActiveLeaseDeferralError(deferMs, emailId);
    }

    // Any other status (e.g. DRAFT)
    return;
  }

  // Worker won the claim! Load email details needed for SMTP dispatch
  email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) {
    console.warn(`[Worker] Email ${emailId} not found after claim. Discarding job.`);
    return;
  }
  const initialAttemptCount = Math.max(0, email.attemptCount - 1);

  // 2. Check distributed rate limiter (if initialised)
  if (limiter) {
    try {
      const result = await limiter.acquireSendSlot(email.userId);

      if (!result.allowed) {
        // Rate limited — revert to SCHEDULED and defer the job
        console.log(
          `[Worker] ⏳ Rate limited email ${emailId}: ${result.reason} ` +
          `Deferring for ${result.retryAfterMs}ms.`
        );

        // Conditional revert: only revert if STILL in PROCESSING
        await prisma.email.updateMany({
          where: { id: emailId, status: 'PROCESSING' },
          data: {
            status: 'SCHEDULED',
            attemptCount: initialAttemptCount,
          },
        });

        // Move job to delayed state — does NOT consume a BullMQ retry attempt
        await job.moveToDelayed(Date.now() + result.retryAfterMs, lockToken);

        // Dispatch Slack alert asynchronously with Redis deduplication
        if (limiter.redis) {
          dispatchRateLimitAlert(limiter.redis, {
            scope: email.userId || 'global',
            hourlyLimit: limiter.maxPerHour,
            retryAfterMs: result.retryAfterMs,
            reason: result.reason,
          }).catch((err) => {
            console.warn('[Worker] Slack rate-limit alert dispatch failed:', err);
          });
        }

        // Throw DelayedError so BullMQ recognizes this job as delayed, skips moveToFailed
        throw new RateLimitDeferralError(result.retryAfterMs, result.reason ?? 'Rate limited');
      }
    } catch (err: unknown) {
      if (err instanceof RateLimitDeferralError) {
        throw err; // Propagate to BullMQ — job is already moved to delayed
      }
      // Redis failure — treat as transient error, DO NOT bypass rate limiting
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Worker] ❌ Rate limiter error for email ${emailId}: ${errMsg}`);

      // Conditional revert: only revert if STILL in PROCESSING
      await prisma.email.updateMany({
        where: { id: emailId, status: 'PROCESSING' },
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

  // 4. Pre-send cancellation check: ensure status did not change while waiting for rate limiter
  const preSendCheck = await prisma.email.findUnique({
    where: { id: emailId },
    select: { status: true },
  });

  if (preSendCheck?.status === 'CANCELLED') {
    console.log(`[Worker] Email ${emailId} was CANCELLED before SMTP send. Discarding job.`);
    return;
  }

  // 5. Build HTML body
  const htmlBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4F46E5;">${subject}</h2>
      <div style="color: #374151; line-height: 1.6;">${body.replace(/\n/g, '<br/>')}</div>
      <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
      <p style="color: #9CA3AF; font-size: 12px;">Sent via ReachInbox Email Scheduler</p>
    </div>`;

  // 6. Send via SMTP (Ethereal in dev, configured SMTP in prod)
  let sendResult: SendResult;
  try {
    sendResult = await sendEmail({
      to: recipient,
      subject,
      html: htmlBody,
      text: body,
    });
  } catch (smtpErr: unknown) {
    await handleSmtpFailure(prisma, emailId, recipient, job, smtpErr);
    throw smtpErr;
  }

  // 7. Persist SENT state and outbox event with localized DB retries
  await persistSentStateWithRetry(prisma, emailId, recipient, sendResult);

  console.log(
    `[Worker] ✅ Email ${emailId} accepted by SMTP. messageId=${sendResult.messageId}` +
    (sendResult.previewUrl ? `\n[Worker] 🔗 Ethereal Preview: ${sendResult.previewUrl}` : '')
  );
}
