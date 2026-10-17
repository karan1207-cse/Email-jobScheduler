/**
 * Integration tests against a real Redis (no mocks).
 *
 * Covers the behaviour the unit tests can only simulate: the rate-limit Lua
 * script, atomicity across connections, BullMQ delayed jobs surviving a
 * restart, jobId idempotency, worker concurrency and rate-limit rescheduling.
 *
 * Uses REDIS_TEST_URL (default redis://localhost:6379/15) and skips itself
 * when that Redis is not reachable, so `npm test` still works without Docker.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { Queue, Worker, DelayedError, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DistributedRateLimiter, HOUR_MS } from '../rate-limiter.js';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL || 'redis://localhost:6379/15';

async function redisAvailable(): Promise<boolean> {
  const probe = new Redis(REDIS_TEST_URL, {
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}


const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function connection(): Redis {
  return new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: null });
}

describe('Real Redis integration', () => {
  let available = false;
  const opened: Redis[] = [];
  const prefix = `rl:test:${randomUUID()}`;
  const queuePrefix = `bulltest-${randomUUID()}`;

  function open(): Redis {
    const client = connection();
    opened.push(client);
    return client;
  }

  beforeAll(async () => {
    available = await redisAvailable();
    if (!available) {
      console.warn(`[redis-integration] Skipping: no Redis at ${REDIS_TEST_URL}`);
      return;
    }
    open();
  });

  beforeEach((context) => {
    if (!available) context.skip();
  });

  afterAll(async () => {
    const cleanup = opened[0];
    if (!cleanup) return;
    for (const pattern of [`${prefix}*`, `${queuePrefix}*`]) {
      const keys = await cleanup.keys(pattern);
      if (keys.length) await cleanup.del(...keys);
    }
    await Promise.all(opened.map((client) => client.quit().catch(() => undefined)));
  });

  describe('DistributedRateLimiter Lua script', () => {
    it('allows exactly maxPerHour sends, then reschedules to the next clock hour', async () => {
      const limiter = new DistributedRateLimiter(open(), {
        prefix: `${prefix}:a`, maxPerHour: 3, intervalMs: 0, scope: 'per-sender',
      });

      const results = [];
      for (let i = 0; i < 4; i++) results.push(await limiter.acquireSendSlot('sender-1'));

      expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
      const denied = results[3]!;
      expect(denied.allowed).toBe(false);
      expect(denied.limitType).toBe('hourly');
      expect(denied.retryAt).toBe((Math.floor(Date.now() / HOUR_MS) + 1) * HOUR_MS);

      const msUntilNextHour = HOUR_MS - (Date.now() % HOUR_MS);
      // Rescheduled to the start of the next hour window (allow for clock drift and test runtime).
      expect(Math.abs(denied.retryAfterMs - msUntilNextHour)).toBeLessThan(5_000);
      expect(await limiter.getCurrentHourlyCount('sender-1')).toBe(3);
    });

    it('keys counters by hour window and sender, so senders are isolated', async () => {
      const redis = open();
      const limiter = new DistributedRateLimiter(redis, {
        prefix: `${prefix}:b`, maxPerHour: 1, intervalMs: 0, scope: 'per-sender',
      });

      expect((await limiter.acquireSendSlot('alice')).allowed).toBe(true);
      expect((await limiter.acquireSendSlot('alice')).allowed).toBe(false);
      expect((await limiter.acquireSendSlot('bob')).allowed).toBe(true);

      const window = Math.floor(Date.now() / HOUR_MS);
      expect(await redis.get(`${prefix}:b:{user:alice}:hour:${window}`)).toBe('1');
      expect(await redis.pttl(`${prefix}:b:{user:alice}:hour:${window}`)).toBeGreaterThan(HOUR_MS);
    });

    it('enforces the minimum delay between sends without consuming hourly quota', async () => {
      const limiter = new DistributedRateLimiter(open(), {
        prefix: `${prefix}:c`, maxPerHour: 100, intervalMs: 400, scope: 'global',
      });

      expect((await limiter.acquireSendSlot('x')).allowed).toBe(true);
      const paced = await limiter.acquireSendSlot('x');
      expect(paced.allowed).toBe(false);
      expect(paced.limitType).toBe('pacing');
      expect(paced.retryAfterMs).toBeLessThanOrEqual(400);
      expect(await limiter.getCurrentHourlyCount('x')).toBe(1);

      await sleep(450);
      expect((await limiter.acquireSendSlot('x')).allowed).toBe(true);
    });

    it('never over-grants when many workers race on separate connections', async () => {
      const limiters = Array.from({ length: 5 }, () => new DistributedRateLimiter(open(), {
        prefix: `${prefix}:d`, maxPerHour: 7, intervalMs: 0, scope: 'global',
      }));

      const results = await Promise.all(
        Array.from({ length: 50 }, (_, i) => limiters[i % limiters.length]!.acquireSendSlot('s')),
      );

      expect(results.filter((r) => r.allowed)).toHaveLength(7);
      expect(await limiters[0]!.getCurrentHourlyCount('s')).toBe(7);
    });
  });

  describe('BullMQ scheduling guarantees', () => {
    it('a delayed job survives a full restart and runs once, at its scheduled time', async () => {
      const name = `restart-${randomUUID()}`;
      const queue = new Queue(name, { connection: open(), prefix: queuePrefix });
      const scheduledFor = Date.now() + 1_500;
      await queue.add('send-email', { emailId: 'e1' }, { delay: 1_500, jobId: 'email-e1' });

      // "Server restart": every process holding a connection goes away before the job is due.
      await queue.close();

      const runs: number[] = [];
      const worker = new Worker(name, async () => { runs.push(Date.now()); }, {
        connection: open(), prefix: queuePrefix,
      });
      await sleep(3_000);
      await worker.close();

      expect(runs).toHaveLength(1);
      expect(runs[0]).toBeGreaterThanOrEqual(scheduledFor - 50);
    });

    it('re-adding the same jobId (API retry / outbox recovery) does not create a duplicate', async () => {
      const name = `idem-${randomUUID()}`;
      const queue = new Queue(name, { connection: open(), prefix: queuePrefix });
      await queue.add('send-email', { emailId: 'e2' }, { delay: 60_000, jobId: 'email-e2' });
      await queue.add('send-email', { emailId: 'e2' }, { delay: 60_000, jobId: 'email-e2' });

      const counts = await queue.getJobCounts('delayed', 'waiting');
      expect((counts.delayed ?? 0) + (counts.waiting ?? 0)).toBe(1);
      await queue.close();
    });

    it('runs jobs in parallel up to the configured concurrency and no further', async () => {
      const name = `conc-${randomUUID()}`;
      const queue = new Queue(name, { connection: open(), prefix: queuePrefix });
      let inFlight = 0;
      let maxInFlight = 0;
      let done = 0;

      const worker = new Worker(name, async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(150);
        inFlight--;
        done++;
      }, { connection: open(), prefix: queuePrefix, concurrency: 3 });

      await queue.addBulk(Array.from({ length: 9 }, (_, i) => ({
        name: 'send-email', data: { i }, opts: { jobId: `email-c${i}` },
      })));

      for (let i = 0; i < 50 && done < 9; i++) await sleep(100);
      await worker.close();
      await queue.close();

      expect(done).toBe(9);
      expect(maxInFlight).toBe(3);
    });

    it('defers jobs over the hourly limit to the next window instead of failing them, keeping order', async () => {
      const name = `limit-${randomUUID()}`;
      const queue = new Queue(name, { connection: open(), prefix: queuePrefix });
      const limiter = new DistributedRateLimiter(open(), {
        prefix: `${prefix}:e`, maxPerHour: 2, intervalMs: 0, scope: 'per-sender',
      });
      const sent: string[] = [];
      let failed = 0;

      // Same pattern as processEmailJob: moveToDelayed + DelayedError, no retry consumed.
      const worker = new Worker(name, async (job: Job, token?: string) => {
        const slot = await limiter.acquireSendSlot('sender-x');
        if (!slot.allowed) {
          await job.moveToDelayed(slot.retryAt ?? Date.now() + slot.retryAfterMs, token);
          throw new DelayedError();
        }
        sent.push(job.id!);
      }, { connection: open(), prefix: queuePrefix, concurrency: 1 });
      worker.on('failed', () => { failed++; });

      await queue.addBulk(Array.from({ length: 5 }, (_, i) => ({
        name: 'send-email', data: { i }, opts: { jobId: `email-l${i}` },
      })));

      for (let i = 0; i < 50; i++) {
        const delayed = await queue.getDelayedCount();
        if (sent.length === 2 && delayed === 3) break;
        await sleep(100);
      }
      await worker.close();

      expect(sent).toEqual(['email-l0', 'email-l1']);
      expect(failed).toBe(0);

      const delayed = await queue.getDelayed();
      const nextWindow = (Math.floor(Date.now() / HOUR_MS) + 1) * HOUR_MS;
      expect(delayed).toHaveLength(3);
      for (const job of delayed) {
        expect(job.attemptsMade).toBe(0);
        expect(job.timestamp + job.delay).toBeGreaterThanOrEqual(nextWindow - 5_000);
      }
      // getDelayed() returns jobs in the order they will run.
      expect(delayed.map((job) => job.id)).toEqual(['email-l2', 'email-l3', 'email-l4']);
      await queue.obliterate({ force: true });
      await queue.close();
    });
  });
});
