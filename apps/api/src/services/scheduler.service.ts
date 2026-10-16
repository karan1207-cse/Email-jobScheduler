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
    idempotencyKey: email.idempotencyKey,
    attemptCount: email.attemptCount,
    lastError: email.lastError,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
  };
}

export interface ScheduleEmailInput {
  scheduledTime: string; // ISO-8601 date string
}

/**
 * Schedule an existing DRAFT email for future delivery.
 * Atomically updates the email status and creates an OutboxEvent, then enqueues the BullMQ job.
 */
export async function scheduleEmail(
  emailId: string,
  input: ScheduleEmailInput
): Promise<EmailDto> {
  const prisma = getPrismaClient();
  await ensureDevUser();

  const scheduledAt = new Date(input.scheduledTime);
  const now = new Date();

  if (scheduledAt <= now) {
    throw new ConflictError('scheduledTime must be a future date/time.');
  }

  const delayMs = scheduledAt.getTime() - now.getTime();

  // 1. Transactional DB update: Email → SCHEDULED + OutboxEvent → PENDING
  const { email, outboxEventId } = await prisma.$transaction(async (tx) => {
    const existing = await tx.email.findFirst({
      where: { id: emailId, userId: DEV_DEFAULT_USER.id },
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
      jobId: `email:${email.id}`, // Idempotent job ID prevents double-scheduling
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
export async function cancelScheduledEmail(emailId: string): Promise<EmailDto> {
  const prisma = getPrismaClient();
  await ensureDevUser();

  const existing = await prisma.email.findFirst({
    where: { id: emailId, userId: DEV_DEFAULT_USER.id },
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
    const job = await queue.getJob(`email:${emailId}`);
    if (job) {
      await job.remove();
      console.log(`[Scheduler] Removed BullMQ job for email ${emailId}.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Scheduler] Could not remove BullMQ job for email ${emailId}: ${msg}`);
  }

  // Update DB status
  const updated = await prisma.email.update({
    where: { id: emailId },
    data: { status: 'CANCELLED' },
  });

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
      const existingJob = await queue.getJob(`email:${payload.emailId}`);
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
            jobId: `email:${payload.emailId}`,
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
