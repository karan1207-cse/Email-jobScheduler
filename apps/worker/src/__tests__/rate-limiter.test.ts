/**
 * Unit tests for DistributedRateLimiter (Milestone 4 Audit)
 * Mocks Redis client to test atomic Lua-based rate limiting and pacing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DistributedRateLimiter } from '../rate-limiter.js';
import type { Redis } from 'ioredis';

describe('DistributedRateLimiter', () => {
  let mockRedis: {
    eval: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let limiter: DistributedRateLimiter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = {
      eval: vi.fn(),
      get: vi.fn().mockResolvedValue('0'),
    };
    limiter = new DistributedRateLimiter(mockRedis as unknown as Redis);
  });

  describe('acquireSendSlot — Atomic Multi-Key Lua Execution', () => {
    it('should allow send when capacity is available and pacing interval is clear', async () => {
      // Lua script returns {0, 0} = allowed
      mockRedis.eval.mockResolvedValueOnce([0, 0]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it('should block send when hourly limit is reached and return retryAfterMs', async () => {
      // Lua script returns {1, 1800} = hourly limit blocked, 1800s remaining TTL
      mockRedis.eval.mockResolvedValueOnce([1, 1800]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(1800 * 1000);
      expect(result.reason).toContain('Hourly rate limit reached');
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it('should enforce minimum 1000ms delay when hourly TTL is small', async () => {
      // Lua script returns {1, 0} (<1s TTL)
      mockRedis.eval.mockResolvedValueOnce([1, 0]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(1000); // Math.max(0, 1000)
    });

    it('should block send when pacing interval is active without touching hourly counter', async () => {
      // Lua script returns {2, 650} = pacing interval active, 650ms remaining
      mockRedis.eval.mockResolvedValueOnce([2, 650]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(650);
      expect(result.reason).toContain('Send pacing: minimum');
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it('should enforce minimum 100ms delay for pacing deferral', async () => {
      // Lua script returns {2, 20} (20ms remaining)
      mockRedis.eval.mockResolvedValueOnce([2, 20]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(100); // Math.max(20, 100)
    });

    it('should fail safely if Redis throws during script evaluation without sending', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('Redis connection lost'));

      await expect(limiter.acquireSendSlot('user-1')).rejects.toThrow('Redis connection lost');
    });
  });

  describe('Scope Configuration & Cluster Hash-Tags', () => {
    it('should use global key prefix with hash tags when scope is global', async () => {
      const globalLimiter = new DistributedRateLimiter(mockRedis as unknown as Redis, {
        scope: 'global',
        prefix: 'test-prefix',
      });
      mockRedis.eval.mockResolvedValue([0, 0]);

      await globalLimiter.acquireSendSlot('user-123');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        'test-prefix:{global}:hourly',
        'test-prefix:{global}:pace',
        expect.any(String),
        expect.any(String)
      );
    });

    it('should use per-sender key prefix and isolate different senders', async () => {
      const perSenderLimiter = new DistributedRateLimiter(mockRedis as unknown as Redis, {
        scope: 'per-sender',
        prefix: 'test-prefix',
      });
      mockRedis.eval.mockResolvedValue([0, 0]);

      await perSenderLimiter.acquireSendSlot('user-abc');
      await perSenderLimiter.acquireSendSlot('user-xyz');

      // First sender
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        2,
        'test-prefix:{user:user-abc}:hourly',
        'test-prefix:{user:user-abc}:pace',
        expect.any(String),
        expect.any(String)
      );

      // Second sender
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        2,
        'test-prefix:{user:user-xyz}:hourly',
        'test-prefix:{user:user-xyz}:pace',
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe('Concurrent Workers Simulation', () => {
    it('should coordinate atomic slot acquisition across concurrent worker calls', async () => {
      let hourlyCounter = 0;
      let pacingActive = false;

      // Realistic mock representing atomic Redis state across concurrent workers
      mockRedis.eval.mockImplementation(async (
        _script: string,
        _numKeys: number,
        _hourlyKey: string,
        _pacingKey: string,
        maxHourlyArg: string,
        intervalMsArg: string
      ) => {
        const maxHourly = parseInt(maxHourlyArg, 10);
        const intervalMs = parseInt(intervalMsArg, 10);

        // 1. Pacing check
        if (intervalMs > 0 && pacingActive) {
          return [2, 1000]; // Pacing blocked
        }

        // 2. Hourly check
        if (maxHourly > 0) {
          hourlyCounter++;
          if (hourlyCounter > 3) {
            hourlyCounter--;
            return [1, 3600]; // Hourly limit reached
          }
        }

        // 3. Set pacing lock
        if (intervalMs > 0) {
          pacingActive = true;
        }

        return [0, 0]; // Allowed
      });

      // 4 concurrent workers compete for slots
      const results = await Promise.all([
        limiter.acquireSendSlot('concurrent-user'),
        limiter.acquireSendSlot('concurrent-user'),
        limiter.acquireSendSlot('concurrent-user'),
        limiter.acquireSendSlot('concurrent-user'),
      ]);

      const allowedCount = results.filter((r) => r.allowed).length;
      const deniedCount = results.filter((r) => !r.allowed).length;

      // Exactly ONE worker should acquire the slot because of the pacing lock
      expect(allowedCount).toBe(1);
      expect(deniedCount).toBe(3);

      // Denied workers should have proper retry times and reasons
      const denied = results.filter((r) => !r.allowed);
      for (const d of denied) {
        expect(d.retryAfterMs).toBeGreaterThan(0);
        expect(d.reason).toBeDefined();
      }
    });
  });

  describe('getCurrentHourlyCount', () => {
    it('should return current count from Redis', async () => {
      mockRedis.get.mockResolvedValueOnce('42');
      const count = await limiter.getCurrentHourlyCount('user-1');
      expect(count).toBe(42);
    });

    it('should return 0 when key does not exist', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const count = await limiter.getCurrentHourlyCount('user-1');
      expect(count).toBe(0);
    });
  });
});
