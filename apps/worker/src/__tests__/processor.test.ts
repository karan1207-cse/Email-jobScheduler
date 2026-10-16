/**
 * Unit tests for Worker Job Processor (Milestone 4 Audit)
 * Mocks Prisma, Nodemailer, and Redis to verify state transitions,
 * rate limiting, pacing deferrals, DelayedError inheritance, and error recovery.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { DelayedError } from 'bullmq';

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
import {
  processEmailJob,
  initRateLimiter,
  RateLimitDeferralError,
  ActiveLeaseDeferralError,
  PostSendDatabaseError,
  type EmailJobData,
} from '../processor.js';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';

function buildMockJob(
  data: Partial<EmailJobData> = {},
  opts: { attemptsMade?: number; attempts?: number; token?: string } = {}
): Job<EmailJobData> & { moveToDelayed: ReturnType<typeof vi.fn> } {
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
    token: opts.token ?? 'test-lock-token',
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<EmailJobData> & { moveToDelayed: ReturnType<typeof vi.fn> };
}

function buildMockPrisma(
  emailStatus = 'SCHEDULED',
  attemptCount = 0,
  overrides: Record<string, unknown> = {}
) {
  let currentStatus = emailStatus;
  const email = {
    id: 'email-uuid-1',
    userId: '00000000-0000-0000-0000-000000000001',
    recipient: 'user@example.com',
    subject: 'Hello Test',
    body: 'Test email body',
    get status() {
      return currentStatus;
    },
    set status(val: string) {
      currentStatus = val;
    },
    scheduledTime: new Date(),
    sentAt: null,
    attemptCount,
    lastError: null,
    createdAt: new Date(),
    // Default for PROCESSING: simulate expired lease (> 60s) unless explicitly specified
    updatedAt: emailStatus === 'PROCESSING'
      ? new Date(Date.now() - 120_000)
      : new Date(),
    ...overrides,
  };

  return {
    email: {
      findUnique: vi.fn().mockImplementation(async () => ({ ...email, status: currentStatus })),
      update: vi.fn().mockImplementation(async (args: any) => {
        if (args.data?.status) {
          currentStatus = args.data.status;
        }
        return { ...email, ...args.data, status: currentStatus };
      }),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        if (args.where?.status) {
          const expected = args.where.status;
          const matches = Array.isArray(expected)
            ? expected.includes(currentStatus)
            : expected?.in
            ? expected.in.includes(currentStatus)
            : currentStatus === expected;
          if (!matches) {
            return { count: 0 };
          }
        }
        if (args.data?.status) {
          currentStatus = args.data.status;
        }
        return { count: 1 };
      }),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({ id: 'outbox-uuid' }),
    },
  };
}

describe('Worker Processor — processEmailJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (sendEmail as MockedFunction<typeof sendEmail>).mockResolvedValue({
      messageId: '<test-msg-id@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/test123',
    });
    initRateLimiter(null); // Default: rate limiter disabled unless explicitly set
  });

  describe('Core Delivery & Edge Cases', () => {
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

      // Should have atomically claimed via updateMany (SCHEDULED -> PROCESSING)
      expect(prisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'SCHEDULED' },
          data: expect.objectContaining({ status: 'PROCESSING' }),
        })
      );
      // And marked SENT via conditional updateMany (PROCESSING -> SENT)
      expect(prisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({ status: 'SENT' }),
        })
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

      // Should mark FAILED on last attempt via conditional updateMany
      expect(prisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({ status: 'FAILED' }),
        })
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

      // Should revert to SCHEDULED (not FAILED) for retry via conditional updateMany
      expect(prisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({ status: 'SCHEDULED' }),
        })
      );
      // Should NOT create EMAIL_FAILED event yet
      const createCalls = (prisma.outboxEvent.create as ReturnType<typeof vi.fn>).mock.calls;
      const failedEvents = createCalls.filter(
        (call: unknown[]) => (call[0] as { data?: { eventType?: string } })?.data?.eventType === 'EMAIL_FAILED'
      );
      expect(failedEvents).toHaveLength(0);
    });

    it('should abort before sending if email was cancelled while job was active', async () => {
      const prisma = buildMockPrisma('SCHEDULED');
      // 1st findUnique returns active SCHEDULED; 2nd findUnique (pre-send check) returns CANCELLED
      prisma.email.findUnique
        .mockResolvedValueOnce({
          id: 'email-uuid-1',
          userId: '00000000-0000-0000-0000-000000000001',
          recipient: 'user@example.com',
          subject: 'Hello Test',
          body: 'Test email body',
          status: 'SCHEDULED',
          scheduledTime: new Date(),
          sentAt: null,
          attemptCount: 0,
          lastError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({ status: 'CANCELLED' });

      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();
      await expect(processEmailJob(job)).resolves.toBeUndefined();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('should recover when post-send database update succeeds on retry', async () => {
      const prisma = buildMockPrisma('SCHEDULED');
      let attempt = 0;
      prisma.email.update.mockImplementation(async (args: any) => {
        if (args.data.status === 'PROCESSING') {
          return { id: 'email-uuid-1', status: 'PROCESSING' };
        }
        attempt++;
        if (attempt === 1) {
          throw new Error('Transient DB socket error');
        }
        return { id: 'email-uuid-1', status: 'SENT', sentAt: new Date() };
      });
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();
      await expect(processEmailJob(job)).resolves.toBeUndefined();
      expect(sendEmail).toHaveBeenCalledOnce();
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: 'EMAIL_SENT' }) })
      );
    });

    it('should throw PostSendDatabaseError and record diagnostic error when post-send persistence permanently fails', async () => {
      const prisma = buildMockPrisma('SCHEDULED');
      prisma.email.updateMany.mockImplementation(async (args: any) => {
        if (args.where?.status === 'SCHEDULED') {
          return { count: 1 };
        }
        if (args.data?.status === 'SENT') {
          throw new Error('Fatal database disk failure');
        }
        return { count: 1 };
      });
      prisma.email.update.mockImplementation(async () => {
        // Diagnostic update (lastError update) succeeds
        return { id: 'email-uuid-1' };
      });
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();
      await expect(processEmailJob(job)).rejects.toThrow(PostSendDatabaseError);

      // Verified SMTP was called and accepted
      expect(sendEmail).toHaveBeenCalledOnce();

      // Verified diagnostic record was saved with messageId
      expect(prisma.email.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1' },
          data: expect.objectContaining({
            lastError: expect.stringContaining(
              '[SMTP_ACCEPTED_DB_ERROR] messageId=<test-msg-id@ethereal.email>'
            ),
          }),
        })
      );
    });

    it('REGRESSION: should quarantine (FAILED, no re-send) when job retries after a post-send DB crash', async () => {
      // Simulate the crash scenario:
      // Email is stuck in PROCESSING from a prior attempt that crashed after SMTP accepted.
      // The PROCESSING guard must block re-delivery.
      const prisma = buildMockPrisma('PROCESSING');
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();
      // Must resolve (not throw) — the quarantine path marks as FAILED and returns
      await expect(processEmailJob(job)).resolves.toBeUndefined();

      // CRITICAL: SMTP must NOT have been called — duplicate delivery blocked
      expect(sendEmail).not.toHaveBeenCalled();

      // Email must be transitioned to FAILED with operator-readable quarantine message via conditional updateMany
      expect(prisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({
            status: 'FAILED',
            lastError: expect.stringContaining('[POST_SEND_QUARANTINE]'),
          }),
        })
      );
    });

    it('a. Concurrent worker attempts: should defer job without marking FAILED when second worker encounters active PROCESSING lease', async () => {
      // Simulate Worker A holding an active lease (updated 5 seconds ago)
      const prisma = buildMockPrisma('PROCESSING', 1, {
        updatedAt: new Date(Date.now() - 5_000), // Active lease (< 60s)
      });
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      // Worker B receives job (attemptsMade=0: first attempt for this worker)
      const job = buildMockJob({}, { attemptsMade: 0, token: 'worker-b-token' });

      // Worker B executes: must reject with ActiveLeaseDeferralError (extending DelayedError)
      // to ensure BullMQ defers the job rather than marking it completed or consuming retries
      await expect(processEmailJob(job)).rejects.toThrow(ActiveLeaseDeferralError);

      // Must have invoked BullMQ's moveToDelayed with worker lock token
      expect(job.moveToDelayed).toHaveBeenCalledWith(
        expect.any(Number),
        'worker-b-token'
      );

      // Worker B must NOT call sendEmail
      expect(sendEmail).not.toHaveBeenCalled();

      // Worker B must NOT mark the email FAILED
      expect(prisma.email.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        })
      );
    });

    it('b. Cancellation during active send: does not corrupt status if send has completed', async () => {
      let emailState = 'SCHEDULED';
      let recordedLastError: string | null = null;
      const prisma = {
        email: {
          findUnique: vi.fn().mockImplementation(async () => ({
            id: 'email-uuid-1',
            userId: '00000000-0000-0000-0000-000000000001',
            recipient: 'user@example.com',
            subject: 'Hello Test',
            body: 'Test body',
            status: emailState,
            lastError: recordedLastError,
            attemptCount: 1,
            updatedAt: new Date(),
          })),
          update: vi.fn().mockImplementation(async (args: any) => {
            if (args.data?.lastError !== undefined) {
              recordedLastError = args.data.lastError;
            }
            if (args.data?.status) {
              emailState = args.data.status;
            }
            return { id: 'email-uuid-1', status: emailState, lastError: recordedLastError };
          }),
          updateMany: vi.fn().mockImplementation(async (args: any) => {
            if (args.where?.status) {
              if (emailState !== args.where.status) {
                return { count: 0 };
              }
            }
            if (args.data?.status) {
              emailState = args.data.status;
            }
            return { count: 1 };
          }),
        },
        outboxEvent: {
          create: vi.fn().mockResolvedValue({ id: 'outbox-uuid' }),
        },
      };

      (sendEmail as MockedFunction<typeof sendEmail>).mockImplementationOnce(async () => {
        // Concurrently, an external cancel request modified the database
        emailState = 'CANCELLED';
        return {
          messageId: '<sent-in-flight@ethereal.email>',
          previewUrl: 'https://ethereal.email/message/flight123',
        };
      });

      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();
      await expect(processEmailJob(job)).resolves.toBeUndefined();

      // Send succeeded, but worker lost PROCESSING ownership due to concurrent cancellation
      expect(sendEmail).toHaveBeenCalledOnce();

      // CRITICAL: CANCELLED state is preserved — never overwritten by SENT
      expect(emailState).toBe('CANCELLED');

      // Ambiguous outcome diagnostic recorded with SMTP messageId
      expect(recordedLastError).toContain('[AMBIGUOUS_DELIVERY_STALE_WORKER]');
      expect(recordedLastError).toContain('<sent-in-flight@ethereal.email>');

      // Outbox event created for audit trail with ambiguousOutcome: true
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'EMAIL_SENT',
            payload: expect.objectContaining({
              messageId: '<sent-in-flight@ethereal.email>',
              ambiguousOutcome: true,
              priorStatus: 'CANCELLED',
            }),
          }),
        })
      );
    });

    it('c. Recovery of expired lease vs live worker protection: quarantines expired lease but protects live worker', async () => {
      // 1. Live worker: lease active (updated 10s ago) -> defers via DelayedError without failing
      const livePrisma = buildMockPrisma('PROCESSING', 1, {
        updatedAt: new Date(Date.now() - 10_000),
      });
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(livePrisma as never);

      const liveJob = buildMockJob({}, { attemptsMade: 0 });
      await expect(processEmailJob(liveJob)).rejects.toThrow(ActiveLeaseDeferralError);
      expect(liveJob.moveToDelayed).toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
      expect(livePrisma.email.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
      );

      vi.clearAllMocks();

      // 2. Expired lease: lease expired (updated 120s ago > 60s lease) -> quarantines to FAILED via conditional updateMany
      const expiredPrisma = buildMockPrisma('PROCESSING', 1, {
        updatedAt: new Date(Date.now() - 120_000),
      });
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(expiredPrisma as never);

      const expiredJob = buildMockJob({}, { attemptsMade: 0 });
      await processEmailJob(expiredJob);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(expiredPrisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({
            status: 'FAILED',
            lastError: expect.stringContaining('[POST_SEND_QUARANTINE]'),
          }),
        })
      );
    });
  });

  describe('Rate Limiting & Pacing Integration (Milestone 4 Audit)', () => {
    let mockRedis: {
      eval: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockRedis = {
        eval: vi.fn(),
        get: vi.fn().mockResolvedValue('0'),
      };
      initRateLimiter(mockRedis as unknown as Redis);
    });

    it('should proceed to send when rate limiter allows send', async () => {
      // Unified script returns {0, 0} = allowed
      mockRedis.eval.mockResolvedValueOnce([0, 0]);

      const prisma = buildMockPrisma('SCHEDULED');
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();
      await processEmailJob(job);

      expect(sendEmail).toHaveBeenCalledOnce();
      expect(prisma.email.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({ status: 'SENT' }),
        })
      );
    });

    it('should defer job when hourly rate limit is reached without consuming retry attempt', async () => {
      // Unified script returns {1, 1800} = hourly limit blocked
      mockRedis.eval.mockResolvedValueOnce([1, 1800]);

      const prisma = buildMockPrisma('SCHEDULED', 0);
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();

      let caughtError: unknown;
      try {
        await processEmailJob(job);
      } catch (err: unknown) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(RateLimitDeferralError);
      expect(caughtError).toBeInstanceOf(DelayedError);
      expect((caughtError as Error).name).toBe('DelayedError');

      // Should NOT attempt SMTP
      expect(sendEmail).not.toHaveBeenCalled();

      // Should have restored attempt count to initial value (0) and status to SCHEDULED via conditional updateMany
      expect(prisma.email.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'email-uuid-1', status: 'PROCESSING' },
        data: {
          status: 'SCHEDULED',
          attemptCount: 0,
        },
      });

      // Should have rescheduled via moveToDelayed with future timestamp
      expect(job.moveToDelayed).toHaveBeenCalled();
      const call = job.moveToDelayed.mock.calls[0]!;
      expect(call[0]).toBeGreaterThan(Date.now());
      expect(call[1]).toBe('test-lock-token');

      // Must NOT be marked as FAILED or create EMAIL_FAILED event
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('should defer job when pacing interval is active', async () => {
      // Unified script returns {2, 500} = pacing blocked
      mockRedis.eval.mockResolvedValueOnce([2, 500]);

      const prisma = buildMockPrisma('SCHEDULED', 0);
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();

      await expect(processEmailJob(job)).rejects.toThrow(RateLimitDeferralError);

      // Should NOT attempt SMTP
      expect(sendEmail).not.toHaveBeenCalled();

      // Should revert status to SCHEDULED and restore attemptCount via conditional updateMany
      expect(prisma.email.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({ status: 'SCHEDULED', attemptCount: 0 }),
        })
      );

      // Should move job to delayed
      expect(job.moveToDelayed).toHaveBeenCalledOnce();
      const pacingCall = job.moveToDelayed.mock.calls[0]!;
      expect(pacingCall[0]).toBeGreaterThanOrEqual(Date.now() + 450);
    });

    it('should forward custom worker token to job.moveToDelayed when provided', async () => {
      mockRedis.eval.mockResolvedValueOnce([2, 500]);

      const prisma = buildMockPrisma('SCHEDULED');
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob({}, { token: 'job-default-token' });

      await expect(processEmailJob(job, 'worker-custom-token')).rejects.toThrow(DelayedError);

      const call = job.moveToDelayed.mock.calls[0]!;
      expect(call[1]).toBe('worker-custom-token');
    });

    it('should fail safely if Redis throws error during rate limiting — no unregulated sends', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('Redis connection down'));

      const prisma = buildMockPrisma('SCHEDULED', 0);
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob();

      await expect(processEmailJob(job)).rejects.toThrow('Redis connection down');

      // Absolutely NO SMTP send allowed when Redis fails
      expect(sendEmail).not.toHaveBeenCalled();

      // Email reverted to SCHEDULED with lastError recorded and attemptCount restored via updateMany
      expect(prisma.email.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'email-uuid-1', status: 'PROCESSING' },
        data: {
          status: 'SCHEDULED',
          attemptCount: 0,
          lastError: expect.stringContaining('Rate limiter unavailable'),
        },
      });
    });
  });

  describe('Audit 5 — Atomic Concurrency & State Transition Regression Suite', () => {
    it('1. Two workers racing to claim the same email: exactly one claim succeeds', async () => {
      let claimCount = 0;
      const prisma = buildMockPrisma('SCHEDULED');
      // Mock atomic database row lock: only first updateMany matching SCHEDULED returns 1
      prisma.email.updateMany.mockImplementation(async (args: any) => {
        if (args.where?.status === 'SCHEDULED') {
          claimCount++;
          if (claimCount === 1) {
            return { count: 1 }; // Worker A wins the claim
          }
          return { count: 0 }; // Worker B loses the claim
        }
        return { count: 1 };
      });

      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const jobA = buildMockJob({}, { token: 'worker-a-token' });
      const jobB = buildMockJob({}, { token: 'worker-b-token' });

      // Worker A runs and claims the email
      await processEmailJob(jobA);
      expect(sendEmail).toHaveBeenCalledOnce();

      vi.clearAllMocks();

      // Worker B runs with email now in PROCESSING with active lease
      prisma.email.findUnique.mockResolvedValue({
        id: 'email-uuid-1',
        userId: '00000000-0000-0000-0000-000000000001',
        recipient: 'user@example.com',
        subject: 'Hello Test',
        body: 'Test email body',
        status: 'PROCESSING',
        attemptCount: 1,
        lastError: null,
        updatedAt: new Date(), // Active lease
      } as any);

      // Worker B MUST reject with ActiveLeaseDeferralError (DelayedError)
      await expect(processEmailJob(jobB)).rejects.toThrow(ActiveLeaseDeferralError);

      // CRITICAL: Loser MUST NOT call SMTP!
      expect(sendEmail).not.toHaveBeenCalled();
      // Job deferred with Worker B's token
      expect(jobB.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'worker-b-token');
    });

    it('2. A stale worker cannot overwrite a newer state', async () => {
      const prisma = buildMockPrisma('SCHEDULED');
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      (sendEmail as MockedFunction<typeof sendEmail>).mockRejectedValueOnce(
        new Error('SMTP connection dropped')
      );

      // Claim succeeds (count: 1), but failure update loses (count: 0) because state changed concurrently (e.g. CANCELLED or SENT)
      prisma.email.updateMany
        .mockResolvedValueOnce({ count: 1 }) // 1. Claim: SCHEDULED -> PROCESSING succeeds
        .mockResolvedValueOnce({ count: 0 }); // 2. handleSmtpFailure: PROCESSING -> FAILED loses (matches 0)

      const job = buildMockJob({}, { attemptsMade: 2, attempts: 3 }); // Last attempt
      await expect(processEmailJob(job)).rejects.toThrow('SMTP connection dropped');

      // Failure must NOT emit outbox event if conditional update matched 0 rows
      const createCalls = (prisma.outboxEvent.create as ReturnType<typeof vi.fn>).mock.calls;
      const failedEvents = createCalls.filter(
        (call: unknown[]) => (call[0] as { data?: { eventType?: string } })?.data?.eventType === 'EMAIL_FAILED'
      );
      expect(failedEvents).toHaveLength(0);
    });

    it('3. A quarantine update loses safely if the email state changes concurrently', async () => {
      // Simulate expired lease, but while quarantine is firing, original worker persisted SENT
      const prisma = buildMockPrisma('PROCESSING', 1, {
        updatedAt: new Date(Date.now() - 120_000), // Expired lease
      });
      // updateMany returns count 0 (state was changed from PROCESSING to SENT by original worker)
      prisma.email.updateMany.mockResolvedValue({ count: 0 });
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob({}, { attemptsMade: 0 });
      await expect(processEmailJob(job)).resolves.toBeUndefined();

      expect(sendEmail).not.toHaveBeenCalled();
      expect(prisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({ status: 'FAILED' }),
        })
      );
    });

    it('4. An active duplicate job is deferred using the supported BullMQ mechanism', async () => {
      const prisma = buildMockPrisma('PROCESSING', 1, {
        updatedAt: new Date(Date.now() - 5_000), // Active lease (<60s)
      });
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      const job = buildMockJob({}, { attemptsMade: 0, token: 'worker-token-xyz' });
      const deferPromise = processEmailJob(job);

      // Must throw ActiveLeaseDeferralError which satisfies BullMQ DelayedError
      await expect(deferPromise).rejects.toThrow(ActiveLeaseDeferralError);
      await expect(deferPromise).rejects.toThrow(DelayedError);

      expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'worker-token-xyz');
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('5. Ambiguous post-SMTP outcomes do not trigger automatic resend', async () => {
      // Email is in PROCESSING with lastError = [SMTP_ACCEPTED_DB_ERROR]
      const prisma = buildMockPrisma('PROCESSING', 1, {
        lastError: '[SMTP_ACCEPTED_DB_ERROR] messageId=<delivered-msg-123>: connection closed',
        updatedAt: new Date(), // Even if lease timestamp is recent
      });
      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      // BullMQ retries the job (attemptsMade = 1)
      const job = buildMockJob({}, { attemptsMade: 1 });
      await expect(processEmailJob(job)).resolves.toBeUndefined();

      // CRITICAL: sendEmail MUST NOT be called! No duplicate sends!
      expect(sendEmail).not.toHaveBeenCalled();

      // Quarantined to FAILED with operator diagnostic message
      expect(prisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({
            status: 'FAILED',
            lastError: expect.stringContaining('[POST_SEND_QUARANTINE]'),
          }),
        })
      );
    });

    it('6. Stale worker after quarantine: old worker resumes, SMTP reports acceptance, outcome is preserved as ambiguous without overwriting FAILED', async () => {
      let emailState = 'SCHEDULED';
      let lastError: string | null = null;

      const prisma = {
        email: {
          findUnique: vi.fn().mockImplementation(async () => ({
            id: 'email-uuid-1',
            userId: '00000000-0000-0000-0000-000000000001',
            recipient: 'user@example.com',
            subject: 'Hello Test',
            body: 'Test body',
            status: emailState,
            lastError,
            attemptCount: 1,
            updatedAt: new Date(Date.now() - 120_000), // Expired lease
          })),
          update: vi.fn().mockImplementation(async (args: any) => {
            if (args.data?.lastError !== undefined) {
              lastError = args.data.lastError;
            }
            if (args.data?.status) {
              emailState = args.data.status;
            }
            return { id: 'email-uuid-1', status: emailState, lastError };
          }),
          updateMany: vi.fn().mockImplementation(async (args: any) => {
            if (args.where?.status) {
              const expected = args.where.status;
              if (emailState !== expected) {
                return { count: 0 };
              }
            }
            if (args.data?.status) {
              emailState = args.data.status;
            }
            if (args.data?.lastError !== undefined) {
              lastError = args.data.lastError;
            }
            return { count: 1 };
          }),
        },
        outboxEvent: {
          create: vi.fn().mockResolvedValue({ id: 'outbox-uuid' }),
        },
      };

      (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);

      // Simulate Worker A calling sendEmail: while in flight, Worker B executes quarantine!
      (sendEmail as MockedFunction<typeof sendEmail>).mockImplementationOnce(async () => {
        // Worker B quarantines the expired lease to FAILED
        emailState = 'FAILED';
        lastError = '[POST_SEND_QUARANTINE] Prior attempt timed out';
        return {
          messageId: '<stale-worker-accepted-123@ethereal.email>',
          previewUrl: 'https://ethereal.email/message/stale123',
        };
      });

      const jobA = buildMockJob({}, { token: 'worker-a-token' });

      // Worker A completes processing
      await expect(processEmailJob(jobA)).resolves.toBeUndefined();

      // 1. sendEmail was called and accepted by SMTP
      expect(sendEmail).toHaveBeenCalledOnce();

      // 2. persistSentStateWithRetry attempted conditional update with status: 'PROCESSING'
      expect(prisma.email.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'email-uuid-1', status: 'PROCESSING' },
          data: expect.objectContaining({ status: 'SENT' }),
        })
      );

      // 3. Status was NOT overwritten to SENT; it remains FAILED
      expect(emailState).toBe('FAILED');

      // 4. lastError was updated with ambiguous delivery diagnostic and messageId
      expect(lastError).toContain('[AMBIGUOUS_DELIVERY_STALE_WORKER]');
      expect(lastError).toContain('<stale-worker-accepted-123@ethereal.email>');

      // 5. OutboxEvent was recorded with ambiguousOutcome: true and messageId
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'EMAIL_SENT',
            payload: expect.objectContaining({
              messageId: '<stale-worker-accepted-123@ethereal.email>',
              ambiguousOutcome: true,
              priorStatus: 'FAILED',
            }),
          }),
        })
      );
    });
  });
});
