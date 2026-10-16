/**
 * BullMQ Job Processor
 * Handles the 'send-email' job: marks email as PROCESSING, sends via SMTP,
 * updates DB on success (SENT) or failure (FAILED), with full retry support.
 */
import type { Job } from 'bullmq';
import { getPrisma } from './prisma.js';
import { sendEmail } from './mailer.js';

export interface EmailJobData {
  emailId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledTime: string;
}

/**
 * Core processor function — called by BullMQ Worker for each job.
 * Must throw to trigger a retry; must return normally to mark job complete.
 */
export async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { emailId, recipient, subject, body } = job.data;
  const prisma = getPrisma();

  console.log(
    `[Worker] Processing job ${job.id} | emailId=${emailId} | attempt=${job.attemptsMade + 1}`
  );

  // 1. Fetch the latest email state from DB
  const email = await prisma.email.findUnique({ where: { id: emailId } });

  if (!email) {
    // Email was deleted — discard job silently
    console.warn(`[Worker] Email ${emailId} not found. Discarding job.`);
    return;
  }

  if (email.status === 'CANCELLED') {
    // Email was cancelled after scheduling — discard job silently
    console.log(`[Worker] Email ${emailId} was CANCELLED. Discarding job.`);
    return;
  }

  if (email.status === 'SENT') {
    // Already sent (duplicate job?) — idempotent discard
    console.log(`[Worker] Email ${emailId} already SENT. Skipping.`);
    return;
  }

  // 2. Mark as PROCESSING and increment attempt counter
  await prisma.email.update({
    where: { id: emailId },
    data: {
      status: 'PROCESSING',
      attemptCount: { increment: 1 },
    },
  });

  try {
    // 3. Build HTML body (preview URL not yet available before sending)
    const htmlBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">${subject}</h2>
        <div style="color: #374151; line-height: 1.6;">${body.replace(/\n/g, '<br/>')}</div>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 12px;">Sent via ReachInbox Email Scheduler</p>
      </div>`;

    // 4. Send via SMTP (Ethereal in dev, real SMTP in prod)
    const result = await sendEmail({
      to: recipient,
      subject,
      html: htmlBody,
    });

    // 4. Mark as SENT with timestamp
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

    // 5. Record successful outbox event
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
      // Record failed outbox event
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
