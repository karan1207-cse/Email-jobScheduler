/**
 * Unit tests for Worker Job Processor
 * Mocks Prisma and the mailer to run without external services.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../prisma.js', () => ({
  getPrisma: vi.fn(),
}));

// ── Mock Mailer ──────────────────────────────────────────────────────────────
vi.mock('../mailer.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({
    messageId: '<test-msg-id@ethereal.email>',
    previewUrl: 'https://ethereal.email/message/test123',
  }),
}));

import { getPrisma } from '../prisma.js';
import { sendEmail } from '../mailer.js';
import { processEmailJob } from '../processor.js';
import type { Job } from 'bullmq';
import type { EmailJobData } from '../processor.js';

function buildMockJob(
  data: Partial<EmailJobData> = {},
  opts: { attemptsMade?: number; attempts?: number } = {}
): Job<EmailJobData> {
  return {
    id: 'job-test-1',
    name: 'send-email',
    data: {
      emailId: 'email-uuid-1',
      recipient: 'user@example.com',
      subject: 'Hello Test',
      body: 'Test email body',
      scheduledTime: new Date().toISOString(),
      ...data,
    },
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: opts.attempts ?? 3 },
  } as unknown as Job<EmailJobData>;
}

function buildMockPrisma(emailStatus = 'SCHEDULED') {
  const email = {
    id: 'email-uuid-1',
    userId: '00000000-0000-0000-0000-000000000001',
    recipient: 'user@example.com',
    subject: 'Hello Test',
    body: 'Test email body',
    status: emailStatus,
    scheduledTime: new Date(),
    sentAt: null,
    attemptCount: 0,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    email: {
      findUnique: vi.fn().mockResolvedValue(email),
      update: vi.fn().mockResolvedValue({ ...email, status: 'SENT', sentAt: new Date() }),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({ id: 'outbox-uuid' }),
    },
  };
}

describe('Worker Processor — processEmailJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should discard job if email is not found in DB', async () => {
    const prisma = buildMockPrisma();
    prisma.email.findUnique.mockResolvedValue(null);
    (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

    const job = buildMockJob();
    await expect(processEmailJob(job)).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('should discard job if email is already CANCELLED', async () => {
    const prisma = buildMockPrisma('CANCELLED');
    (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

    const job = buildMockJob();
    await expect(processEmailJob(job)).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('should discard job idempotently if email is already SENT', async () => {
    const prisma = buildMockPrisma('SENT');
    (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

    const job = buildMockJob();
    await expect(processEmailJob(job)).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('should send email and mark as SENT on success', async () => {
    const prisma = buildMockPrisma('SCHEDULED');
    (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

    const job = buildMockJob();
    await processEmailJob(job);

    // Should have marked PROCESSING then SENT
    expect(prisma.email.update).toHaveBeenCalledTimes(2);
    expect(prisma.email.update).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING' }) })
    );
    expect(prisma.email.update).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) })
    );

    // Should have created EMAIL_SENT outbox event
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'EMAIL_SENT' }) })
    );
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('should mark email as FAILED on last retry attempt and rethrow', async () => {
    const prisma = buildMockPrisma('SCHEDULED');
    (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);
    (sendEmail as MockedFunction<typeof sendEmail>).mockRejectedValue(
      new Error('SMTP connection refused')
    );

    // Last attempt (attemptsMade=2 with attempts=3)
    const job = buildMockJob({}, { attemptsMade: 2, attempts: 3 });
    await expect(processEmailJob(job)).rejects.toThrow('SMTP connection refused');

    // Should mark FAILED on last attempt
    expect(prisma.email.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    );
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'EMAIL_FAILED' }) })
    );
  });

  it('should keep email as SCHEDULED on intermediate retry attempt and rethrow', async () => {
    const prisma = buildMockPrisma('SCHEDULED');
    (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);
    (sendEmail as MockedFunction<typeof sendEmail>).mockRejectedValue(
      new Error('Temporary SMTP error')
    );

    // First attempt (attemptsMade=0, not last)
    const job = buildMockJob({}, { attemptsMade: 0, attempts: 3 });
    await expect(processEmailJob(job)).rejects.toThrow('Temporary SMTP error');

    // Should revert to SCHEDULED (not FAILED) for retry
    expect(prisma.email.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) })
    );
    // Should NOT create EMAIL_FAILED event yet
    const createCalls = (prisma.outboxEvent.create as ReturnType<typeof vi.fn>).mock.calls;
    const failedEvents = createCalls.filter(
      (call: unknown[]) => (call[0] as { data?: { eventType?: string } })?.data?.eventType === 'EMAIL_FAILED'
    );
    expect(failedEvents).toHaveLength(0);
  });
});
