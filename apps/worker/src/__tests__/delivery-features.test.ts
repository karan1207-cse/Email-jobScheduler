/**
 * Unit tests for sender identity, Ethereal delivery details, hourly-window
 * rescheduling and Slack alerting on rate-limit hits.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';

vi.mock('../prisma.js', () => ({ getPrisma: vi.fn() }));
vi.mock('../mailer.js', () => ({
  sendEmail: vi.fn(),
}));
vi.mock('../slack-alert.js', () => ({
  dispatchRateLimitAlert: vi.fn().mockResolvedValue(true),
}));
vi.mock('../es-indexer.js', () => ({ indexEmailDoc: vi.fn().mockResolvedValue(undefined) }));

import { getPrisma } from '../prisma.js';
import { sendEmail } from '../mailer.js';
import { dispatchRateLimitAlert } from '../slack-alert.js';
import { processEmailJob, initRateLimiter, RateLimitDeferralError, type EmailJobData } from '../processor.js';

const SENDER_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

function mockJob(): Job<EmailJobData> & { moveToDelayed: ReturnType<typeof vi.fn> } {
  return {
    id: 'email-1',
    name: 'send-email',
    data: { emailId: 'email-1', recipient: 'lead@example.com', subject: 'Hi', body: 'Body', scheduledTime: new Date().toISOString() },
    attemptsMade: 0,
    opts: { attempts: 3 },
    token: 'lock',
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<EmailJobData> & { moveToDelayed: ReturnType<typeof vi.fn> };
}

function mockPrisma() {
  let status = 'SCHEDULED';
  const row = () => ({
    id: 'email-1', userId: SENDER_ID, recipient: 'lead@example.com', subject: 'Hi', body: 'Body',
    status, attemptCount: 1, lastError: null, attachments: [], scheduledTime: new Date(), sentAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(),
  });
  return {
    email: {
      findUnique: vi.fn(async () => row()),
      update: vi.fn(async () => row()),
      updateMany: vi.fn(async (args: { where: { status?: string }; data: { status?: string } }) => {
        if (args.where.status && args.where.status !== status) return { count: 0 };
        if (args.data.status) status = args.data.status;
        return { count: 1 };
      }),
    },
    user: {
      findUnique: vi.fn(async () => ({ email: 'alice@sender.test', displayName: 'Alice Sender' })),
    },
    outboxEvent: { create: vi.fn(async () => ({ id: 'o1' })) },
  };
}

describe('processEmailJob — senders, delivery details and rate-limit alerts', () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = mockPrisma();
    (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue(prisma as never);
    (sendEmail as MockedFunction<typeof sendEmail>).mockResolvedValue({
      messageId: '<m1@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/abc',
    });
    initRateLimiter(null);
  });

  it('sends as the owning user and stores the Message-ID and Ethereal preview link', async () => {
    await processEmailJob(mockJob());

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'lead@example.com',
      sender: { email: 'alice@sender.test', name: 'Alice Sender' },
    }));
    expect(prisma.email.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'email-1', status: 'PROCESSING' },
      data: expect.objectContaining({
        status: 'SENT',
        messageId: '<m1@ethereal.email>',
        previewUrl: 'https://ethereal.email/message/abc',
      }),
    }));
  });

  it('still sends (with the default From) when the sender lookup fails', async () => {
    prisma.user.findUnique.mockRejectedValueOnce(new Error('db blip'));
    await processEmailJob(mockJob());
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ sender: undefined }));
  });

  it('on an hourly limit hit: reschedules to the next window start, reverts to SCHEDULED, alerts Slack', async () => {
    const nextWindow = (Math.floor(Date.now() / 3_600_000) + 1) * 3_600_000;
    const redis = { eval: vi.fn().mockResolvedValue([1, nextWindow - Date.now(), nextWindow]) };
    initRateLimiter(redis as unknown as Redis);
    const job = mockJob();

    await expect(processEmailJob(job)).rejects.toBeInstanceOf(RateLimitDeferralError);

    expect(job.moveToDelayed).toHaveBeenCalledWith(nextWindow, 'lock');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prisma.email.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SCHEDULED' }),
    }));
    expect(dispatchRateLimitAlert).toHaveBeenCalledWith(redis, expect.objectContaining({
      userId: SENDER_ID,
      hourlyLimit: expect.any(Number),
    }));
  });

  it('does not alert Slack for routine pacing waits', async () => {
    const redis = { eval: vi.fn().mockResolvedValue([2, 800]) };
    initRateLimiter(redis as unknown as Redis);
    const job = mockJob();

    await expect(processEmailJob(job)).rejects.toBeInstanceOf(RateLimitDeferralError);

    expect(job.moveToDelayed).toHaveBeenCalledOnce();
    expect(dispatchRateLimitAlert).not.toHaveBeenCalled();
  });
});
