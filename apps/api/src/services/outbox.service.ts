import type { Email, OutboxEvent } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { DEV_DEFAULT_USER, ensureDevUser } from './email.service.js';

export interface ScheduleEmailOutboxInput {
  recipient: string;
  subject: string;
  body: string;
  scheduledTime: Date;
}

export interface ScheduledOutboxResult {
  email: Email;
  outboxEvent: OutboxEvent;
}

/**
 * Transactional Outbox Helper:
 * Demonstrates the atomic creation of an Email row and its corresponding OutboxEvent row
 * within a single PostgreSQL transaction.
 * 
 * In Milestone 2, this provides the persistence pattern for reliable job scheduling.
 * In Milestone 3 & 4, an outbox dispatcher will poll unprocessed OutboxEvent records
 * and reliably enqueue them into BullMQ/Redis without dual-write inconsistencies.
 */
export async function createScheduledEmailWithOutbox(
  input: ScheduleEmailOutboxInput
): Promise<ScheduledOutboxResult> {
  const prisma = getPrismaClient();
  await ensureDevUser();

  return prisma.$transaction(async (tx) => {
    // 1. Create email in SCHEDULED state
    const email = await tx.email.create({
      data: {
        userId: DEV_DEFAULT_USER.id,
        recipient: input.recipient.trim(),
        subject: input.subject.trim(),
        body: input.body,
        status: 'SCHEDULED',
        scheduledTime: input.scheduledTime,
      },
    });

    // 2. Atomically create corresponding Outbox event in same transaction
    const outboxEvent = await tx.outboxEvent.create({
      data: {
        eventType: 'EMAIL_SCHEDULED',
        aggregateId: email.id,
        payload: {
          emailId: email.id,
          recipient: email.recipient,
          scheduledTime: input.scheduledTime.toISOString(),
        },
        status: 'PENDING',
      },
    });

    return { email, outboxEvent };
  });
}
