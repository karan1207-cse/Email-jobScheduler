/**
 * Startup reconciliation: every SCHEDULED email ends up with exactly one live job.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('../db/prisma.js', () => ({ getPrismaClient: vi.fn() }));
vi.mock('../redis/client.js', () => ({ getRedisClient: vi.fn(() => ({})) }));

const jobs = new Map<string, { getState: () => Promise<string>; retry: ReturnType<typeof vi.fn> }>();
const add = vi.fn(async (_name: string, _data: unknown, opts: { jobId: string; delay: number }) => ({ id: opts.jobId }));
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add,
    getJob: vi.fn(async (id: string) => jobs.get(id) ?? null),
    close: vi.fn(),
    on: vi.fn(),
  })),
}));

import { getPrismaClient } from '../db/prisma.js';
import { reconcileScheduledEmails } from '../services/scheduler.service.js';

function email(id: string, scheduledInMs: number) {
  return {
    id, recipient: `${id}@example.com`, subject: 's', body: 'b', status: 'SCHEDULED',
    scheduledTime: new Date(Date.now() + scheduledInMs),
  };
}

describe('reconcileScheduledEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobs.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('re-enqueues missing jobs, retries failed ones and leaves live jobs alone', async () => {
    const rows = [email('a', 60_000), email('b', -5_000), email('c', 60_000), email('d', 60_000)];
    jobs.set('email-c', { getState: async () => 'failed', retry: vi.fn() });
    jobs.set('email-d', { getState: async () => 'delayed', retry: vi.fn() });
    const findMany = vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue({ email: { findMany } } as never);

    const result = await reconcileScheduledEmails();

    expect(result).toEqual({ requeued: 2, retried: 1 });
    expect(add).toHaveBeenCalledTimes(2);
    // Future email keeps its schedule; an overdue one runs now. Deterministic jobIds prevent duplicates.
    const delayFor = (jobId: string) => add.mock.calls.find((call) => call[2].jobId === jobId)![2] as { delay: number };
    expect(delayFor('email-a').delay).toBeGreaterThan(55_000);
    expect(delayFor('email-b').delay).toBe(0);
    expect(jobs.get('email-c')!.retry).toHaveBeenCalledWith('failed');
    expect(jobs.get('email-d')!.retry).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'SCHEDULED' } }));
  });

  it('pages through large backlogs', async () => {
    const page1 = [email('p1', 1_000), email('p2', 1_000)];
    const page2 = [email('p3', 1_000)];
    const findMany = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    (getPrismaClient as MockedFunction<typeof getPrismaClient>).mockReturnValue({ email: { findMany } } as never);

    const result = await reconcileScheduledEmails(2);

    expect(result.requeued).toBe(3);
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: 'p2' }, skip: 1 }));
  });
});
