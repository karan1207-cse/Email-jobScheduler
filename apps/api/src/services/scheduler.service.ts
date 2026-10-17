/**
 * Email Scheduler Service
 * Handles scheduling, cancellation, and outbox-based crash recovery.
 */
import { getPrismaClient } from '../db/prisma.js';
import { getEmailQueue } from '../queue/queue.js';
import { EMAIL_JOB_NAME } from '../queue/types.js';
import { NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { DEV_DEFAULT_USER, ensureDevUser } from './email.service.js';
import type { EmailDto } from '@reachinbox/shared';
import type { Email } from '@prisma/client';

function mapToDto(email: Email): EmailDto {
  return {
    id: email.id,
    userId: email.userId,
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    status: email.status as EmailDto['status'],
    scheduledTime: email.scheduledTime ? email.scheduledTime.toISOString() : null,
    sentAt: email.sentAt ? email.sentAt.toISOString() : null,
    messageId: email.messageId ?? null,
    previewUrl: email.previewUrl ?? null,
    idempotencyKey: email.idempotencyKey,
    attemptCount: email.attemptCount,
    lastError: email.lastError,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
  };
}

/** How far in the past a requested send time may be and still mean "send now". */
const SEND_NOW_GRACE_MS = 30_000;

export interface ScheduleEmailInput {
  scheduledTime: string; // ISO-8601 date string
}

/**
 * Schedule an existing DRAFT email for future delivery.
 * Atomically updates the email status and creates an OutboxEvent, then enqueues the BullMQ job.
 */
export async function scheduleEmail(
  emailId: string,
  input: ScheduleEmailInput,
  userId: string = DEV_DEFAULT_USER.id
): Promise<EmailDto> {
  const prisma = getPrismaClient();
  if (userId === DEV_DEFAULT_USER.id) {
    await ensureDevUser();
  }

  const requestedAt = new Date(input.scheduledTime);
  const now = new Date();

  // "Send now" from the dashboard asks for a time a few seconds ahead, which
  // can already have passed by the time the request lands (slow network, a
  // slightly fast server clock). Treat a time up to SEND_NOW_GRACE_MS in the
  // past as "send immediately"; anything older is still rejected.
  if (requestedAt.getTime() < now.getTime() - SEND_NOW_GRACE_MS) {
    throw new ConflictError('scheduledTime must be a future date/time.');
  }
  const scheduledAt = requestedAt > now ? requestedAt : now;

  const delayMs = scheduledAt.getTime() - now.getTime();

  // 1. Transactional DB update: Email → SCHEDULED + OutboxEvent → PENDING
  const { email, outboxEventId } = await prisma.$transaction(async (tx) => {
    const existing = await tx.email.findFirst({
      where: { id: emailId, userId },
    });

    if (!existing) {
      throw new NotFoundError(`Email '${emailId}' not found.`);
    }

    if (existing.status !== 'DRAFT') {
      throw new ConflictError(
        `Cannot schedule email with status '${existing.status}'. Only DRAFT emails can be scheduled.`
      );
    }

    const updated = await tx.email.update({
      where: { id: emailId },
      data: {
        status: 'SCHEDULED',
        scheduledTime: scheduledAt,
      },
    });

    const outboxEvent = await tx.outboxEvent.create({
      data: {
        eventType: 'EMAIL_SCHEDULED',
        aggregateId: emailId,
        payload: {
          emailId,
          recipient: updated.recipient,
          subject: updated.subject,
          body: updated.body,
          scheduledTime: scheduledAt.toISOString(),
        },
        status: 'PENDING',
      },
    });

    return { email: updated, outboxEventId: outboxEvent.id };
  });

  // 2. Enqueue BullMQ job with calculated delay
  const queue = getEmailQueue();
  const job = await queue.add(
    EMAIL_JOB_NAME,
    {
      emailId: email.id,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      scheduledTime: scheduledAt.toISOString(),
    },
    {
      delay: delayMs,
      jobId: `email-${email.id}`, // BullMQ custom IDs cannot contain ':'
    }
  );

  console.log(
    `[Scheduler] Enqueued job ${job.id} for email ${email.id} ` +
    `(delay: ${Math.round(delayMs / 1000)}s, scheduled: ${scheduledAt.toISOString()})`
  );

  // 3. Mark OutboxEvent as PROCESSED (job successfully handed to BullMQ)
  await prisma.outboxEvent.update({
    where: { id: outboxEventId },
    data: { status: 'PROCESSED', processedAt: new Date() },
  });

  return mapToDto(email);
}

/**
 * Cancel a SCHEDULED email. Removes the BullMQ job and marks the email CANCELLED.
 */
export async function cancelScheduledEmail(
  emailId: string,
  userId: string = DEV_DEFAULT_USER.id
): Promise<EmailDto> {
  const prisma = getPrismaClient();
  if (userId === DEV_DEFAULT_USER.id) {
    await ensureDevUser();
  }

  const existing = await prisma.email.findFirst({
    where: { id: emailId, userId },
  });

  if (!existing) {
    throw new NotFoundError(`Email '${emailId}' not found.`);
  }

  if (existing.status !== 'SCHEDULED') {
    throw new ConflictError(
      `Cannot cancel email with status '${existing.status}'. Only SCHEDULED emails can be cancelled.`
    );
  }

  // Remove job from BullMQ (best-effort — job may have already been picked up)
  try {
    const queue = getEmailQueue();
    const job = await queue.getJob(`email-${emailId}`);
    if (job) {
      await job.remove();
      console.log(`[Scheduler] Removed BullMQ job for email ${emailId}.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Scheduler] Could not remove BullMQ job for email ${emailId}: ${msg}`);
  }

  // Atomic conditional update: ensure status is STILL SCHEDULED at DB level
  // If a worker claimed it (PROCESSING) or delivered it (SENT) concurrently,
  // updateMany will match 0 rows, preventing cancellation from overwriting active/sent email.
  const cancelResult = await prisma.email.updateMany({
    where: { id: emailId, status: 'SCHEDULED' },
    data: { status: 'CANCELLED' },
  });

  if (cancelResult.count === 0) {
    const current = await prisma.email.findUnique({ where: { id: emailId } });
    throw new ConflictError(
      `Cannot cancel email with status '${current?.status}'. Only SCHEDULED emails can be cancelled.`
    );
  }

  const updated = {
    ...existing,
    status: 'CANCELLED' as const,
  };

  // Record cancellation in outbox for auditing
  await prisma.outboxEvent.create({
    data: {
      eventType: 'EMAIL_CANCELLED',
      aggregateId: emailId,
      payload: { emailId },
      status: 'PROCESSED',
      processedAt: new Date(),
    },
  });

  return mapToDto(updated);
}

/**
 * Outbox Recovery: On worker/API restart, re-enqueue any PENDING outbox events
 * whose corresponding email is still SCHEDULED (not yet processed or cancelled).
 * This prevents jobs from being silently lost during a crash between DB-write and BullMQ-enqueue.
 */
export async function recoverPendingOutboxEvents(): Promise<void> {
  const prisma = getPrismaClient();
  const queue = getEmailQueue();

  const pendingEvents = await prisma.outboxEvent.findMany({
    where: {
      eventType: 'EMAIL_SCHEDULED',
      status: 'PENDING',
    },
    orderBy: { createdAt: 'asc' },
  });

  if (pendingEvents.length === 0) {
    console.log('[OutboxRecovery] No pending outbox events found.');
    return;
  }

  console.log(`[OutboxRecovery] Found ${pendingEvents.length} pending outbox event(s) to recover.`);

  for (const event of pendingEvents) {
    try {
      const payload = event.payload as {
        emailId: string;
        recipient: string;
        subject: string;
        body: string;
        scheduledTime: string;
      };

      const email = await prisma.email.findUnique({
        where: { id: payload.emailId },
      });

      if (!email || email.status !== 'SCHEDULED') {
        // Email is no longer schedulable — mark event as processed/failed
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: email ? 'PROCESSED' : 'FAILED',
            processedAt: new Date(),
            lastError: email
              ? `Email status is '${email.status}' — already handled.`
              : 'Email record not found during recovery.',
          },
        });
        continue;
      }

      const scheduledAt = new Date(payload.scheduledTime);
      const now = new Date();
      const delayMs = Math.max(0, scheduledAt.getTime() - now.getTime());

      // Check if job already exists in BullMQ
      const existingJob = await queue.getJob(`email-${payload.emailId}`);
      if (existingJob) {
        console.log(`[OutboxRecovery] Job already exists for email ${payload.emailId}, skipping.`);
      } else {
        await queue.add(
          EMAIL_JOB_NAME,
          {
            emailId: payload.emailId,
            recipient: payload.recipient,
            subject: payload.subject,
            body: payload.body,
            scheduledTime: payload.scheduledTime,
          },
          {
            delay: delayMs,
            jobId: `email-${payload.emailId}`,
          }
        );
        console.log(
          `[OutboxRecovery] Re-enqueued job for email ${payload.emailId} ` +
          `(delay: ${Math.round(delayMs / 1000)}s)`
        );
      }

      // Mark outbox event as processed
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[OutboxRecovery] Failed to recover event ${event.id}: ${msg}`);

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          lastError: msg.slice(0, 1000),
          attemptCount: { increment: 1 },
        },
      });
    }
  }

  console.log('[OutboxRecovery] Recovery complete.');
}

/**
 * Startup reconciliation: every SCHEDULED email must have a live BullMQ job.
 *
 * Covers the cases outbox recovery cannot see: Redis lost its data (no AOF, a
 * flushed instance), or a job exhausted its retries before the worker could
 * claim the email (for example the database was down), leaving the row
 * SCHEDULED with a failed job. The deterministic jobId means this can never
 * create a second job for an email that already has one.
 */
export async function reconcileScheduledEmails(batchSize = 500): Promise<{ requeued: number; retried: number }> {
  const prisma = getPrismaClient();
  const queue = getEmailQueue();
  let requeued = 0;
  let retried = 0;
  let cursor: string | undefined;

  for (;;) {
    const emails = await prisma.email.findMany({
      where: { status: 'SCHEDULED' },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (emails.length === 0) break;
    cursor = emails[emails.length - 1]!.id;

    for (const email of emails) {
      const jobId = `email-${email.id}`;
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          if ((await job.getState()) === 'failed') {
            await job.retry('failed');
            retried++;
          }
          continue;
        }
        const scheduledAt = email.scheduledTime ?? new Date();
        await queue.add(
          EMAIL_JOB_NAME,
          {
            emailId: email.id,
            recipient: email.recipient,
            subject: email.subject,
            body: email.body,
            scheduledTime: scheduledAt.toISOString(),
          },
          { delay: Math.max(0, scheduledAt.getTime() - Date.now()), jobId }
        );
        requeued++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Reconcile] Could not reconcile email ${email.id}: ${msg}`);
      }
    }
    if (emails.length < batchSize) break;
  }

  console.log(`[Reconcile] SCHEDULED emails checked: ${requeued} re-enqueued, ${retried} failed jobs retried.`);
  return { requeued, retried };
}
