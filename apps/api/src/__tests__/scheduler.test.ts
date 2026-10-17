/**
 * Unit tests for Scheduler Service
 * These tests mock BullMQ, Prisma, and the Redis client to run without external services.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

// ── Mock dependencies ────────────────────────────────────────────────────────
vi.mock('../db/prisma.js', () => ({
  getPrismaClient: vi.fn(),
}));

vi.mock('../redis/client.js', () => ({
  getRedisClient: vi.fn(() => ({})),
}));

vi.mock('bullmq', () => {
  const add = vi.fn().mockResolvedValue({ id: 'test-job-id' });
  const getJob = vi.fn().mockResolvedValue(null);
  const close = vi.fn().mockResolvedValue(undefined);
  const Queue = vi.fn().mockImplementation(() => ({ add, getJob, close, on: vi.fn() }));
  return { Queue };
});

import { getPrismaClient } from '../db/prisma.js';
import { Queue } from 'bullmq';
import { scheduleEmail, cancelScheduledEmail, recoverPendingOutboxEvents } from '../services/scheduler.service.js';

// ── Mock Prisma builder ──────────────────────────────────────────────────────
function buildMockEmail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'email-uuid-1',
    userId: '00000000-0000-0000-0000-000000000001',
    recipient: 'test@example.com',
    subject: 'Test Subject',
    body: 'Test body',
    status: 'DRAFT',
    scheduledTime: null,
    sentAt: null,
    idempotencyKey: null,
    requestFingerprint: null,
    attemptCount: 0,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildMockPrisma(emailOverrides: Record<string, unknown> = {}) {
  const email = buildMockEmail(emailOverrides);
  const scheduledEmail = { ...email, status: 'SCHEDULED', scheduledTime: new Date(Date.now() + 60000) };
  const cancelledEmail = { ...email, status: 'CANCELLED' };

  const tx = {
    email: {
      findFirst: vi.fn().mockResolvedValue(email),
      update: vi.fn().mockResolvedValue(scheduledEmail),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({ id: 'outbox-uuid-1' }),
    },
  };

  const prisma = {
    $transaction: vi.fn().mockImplementation((fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(tx as Record<string, unknown>)),
    email: {
      findFirst: vi.fn().mockResolvedValue(email),
      findUnique: vi.fn().mockResolvedValue(email),
      update: vi.fn().mockResolvedValue(cancelledEmail),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({ id: 'outbox-uuid-2' }),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  };

  return { prisma, tx };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('Scheduler Service — scheduleEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw ConflictError when scheduledTime is in the past', async () => {
    const { prisma } = buildMockPrisma();
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    const pastTime = new Date(Date.now() - 60000).toISOString();
    await expect(scheduleEmail('email-uuid-1', { scheduledTime: pastTime }))
      .rejects.toThrow('scheduledTime must be a future date/time.');
  });

  it('should throw NotFoundError when email does not exist', async () => {
    const { prisma, tx } = buildMockPrisma();
    tx.email.findFirst.mockResolvedValue(null);
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    const futureTime = new Date(Date.now() + 60000).toISOString();
    await expect(scheduleEmail('nonexistent-id', { scheduledTime: futureTime }))
      .rejects.toThrow("Email 'nonexistent-id' not found.");
  });

  it('should throw ConflictError when email is not in DRAFT status', async () => {
    const { prisma, tx } = buildMockPrisma({ status: 'SENT' });
    tx.email.findFirst.mockResolvedValue(buildMockEmail({ status: 'SENT' }));
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    const futureTime = new Date(Date.now() + 60000).toISOString();
    await expect(scheduleEmail('email-uuid-1', { scheduledTime: futureTime }))
      .rejects.toThrow("Cannot schedule email with status 'SENT'");
  });

  it('should successfully schedule a DRAFT email and return SCHEDULED dto', async () => {
    const { prisma, tx } = buildMockPrisma();
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const result = await scheduleEmail('email-uuid-1', { scheduledTime: futureTime });

    expect(result.status).toBe('SCHEDULED');
    expect(result.id).toBe('email-uuid-1');
    expect(vi.mocked(Queue).mock.results[0]?.value.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ jobId: 'email-email-uuid-1' })
    );
    expect(tx.email.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'email-uuid-1' } })
    );
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'EMAIL_SCHEDULED' }) })
    );
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) })
    );
  });

  it('treats a send time a few seconds in the past as send now', async () => {
    const { prisma, tx } = buildMockPrisma();
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    const before = Date.now();
    const justPassed = new Date(before - 2000).toISOString();
    const result = await scheduleEmail('email-uuid-1', { scheduledTime: justPassed });

    expect(result.status).toBe('SCHEDULED');
    // The stored send time is moved up to "now" rather than left in the past.
    const stored = tx.email.update.mock.calls[0]?.[0]?.data?.scheduledTime as Date;
    expect(stored.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('Scheduler Service — cancelScheduledEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw NotFoundError when email does not exist', async () => {
    const { prisma } = buildMockPrisma();
    prisma.email.findFirst.mockResolvedValue(null);
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    await expect(cancelScheduledEmail('nonexistent-id'))
      .rejects.toThrow("Email 'nonexistent-id' not found.");
  });

  it('should throw ConflictError when email is not SCHEDULED', async () => {
    const { prisma } = buildMockPrisma({ status: 'DRAFT' });
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    await expect(cancelScheduledEmail('email-uuid-1'))
      .rejects.toThrow("Cannot cancel email with status 'DRAFT'.");
  });

  it('should successfully cancel a SCHEDULED email via atomic conditional update', async () => {
    const { prisma } = buildMockPrisma({ status: 'SCHEDULED' });
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    const result = await cancelScheduledEmail('email-uuid-1');
    expect(result.status).toBe('CANCELLED');
    expect(prisma.email.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'email-uuid-1', status: 'SCHEDULED' },
        data: { status: 'CANCELLED' },
      })
    );
  });

  it('should throw ConflictError if email was claimed or sent concurrently during cancellation', async () => {
    const { prisma } = buildMockPrisma({ status: 'SCHEDULED' });
    // Simulate concurrent worker transition: updateMany matches 0 rows
    prisma.email.updateMany.mockResolvedValue({ count: 0 });
    prisma.email.findUnique.mockResolvedValue(buildMockEmail({ status: 'PROCESSING' }));
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    await expect(cancelScheduledEmail('email-uuid-1'))
      .rejects.toThrow("Cannot cancel email with status 'PROCESSING'.");
  });
});

describe('Scheduler Service — recoverPendingOutboxEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do nothing when there are no pending outbox events', async () => {
    const { prisma } = buildMockPrisma();
    prisma.outboxEvent.findMany.mockResolvedValue([]);
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    // Should complete without error
    await expect(recoverPendingOutboxEvents()).resolves.toBeUndefined();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
  });

  it('should re-enqueue a pending outbox event for a SCHEDULED email', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const pendingEvent = {
      id: 'outbox-evt-1',
      eventType: 'EMAIL_SCHEDULED',
      aggregateId: 'email-uuid-1',
      payload: {
        emailId: 'email-uuid-1',
        recipient: 'test@example.com',
        subject: 'Test',
        body: 'Body',
        scheduledTime: futureTime,
      },
      status: 'PENDING',
      createdAt: new Date(),
    };

    const { prisma } = buildMockPrisma({ status: 'SCHEDULED' });
    prisma.outboxEvent.findMany.mockResolvedValue([pendingEvent]);
    prisma.email.findUnique.mockResolvedValue(buildMockEmail({ status: 'SCHEDULED' }));
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    await recoverPendingOutboxEvents();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) })
    );
  });

  it('should mark event as processed when email is no longer SCHEDULED', async () => {
    const pendingEvent = {
      id: 'outbox-evt-2',
      eventType: 'EMAIL_SCHEDULED',
      aggregateId: 'email-uuid-2',
      payload: {
        emailId: 'email-uuid-2',
        recipient: 'test@example.com',
        subject: 'Test',
        body: 'Body',
        scheduledTime: new Date(Date.now() + 3600000).toISOString(),
      },
      status: 'PENDING',
      createdAt: new Date(),
    };

    const { prisma } = buildMockPrisma();
    prisma.outboxEvent.findMany.mockResolvedValue([pendingEvent]);
    prisma.email.findUnique.mockResolvedValue(buildMockEmail({ status: 'SENT' }));
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue(prisma as never);

    await recoverPendingOutboxEvents();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) })
    );
  });
});
