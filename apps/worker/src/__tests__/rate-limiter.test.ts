/**
 * Unit tests for DistributedRateLimiter (Milestone 4)
 * Mocks Redis client to test atomic Lua-based rate limiting and pacing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DistributedRateLimiter } from '../rate-limiter.js';
import type { Redis } from 'ioredis';

describe('DistributedRateLimiter', () => {
  let mockRedis: {
    eval: ReturnType<typeof vi.fn>;
    decr: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let limiter: DistributedRateLimiter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = {
      eval: vi.fn(),
      decr: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue('0'),
    };
    limiter = new DistributedRateLimiter(mockRedis as unknown as Redis);
  });

  describe('acquireSendSlot', () => {
    it('should allow send when capacity is available and pacing interval is clear', async () => {
      // Hourly: allowed [0, 0]
      mockRedis.eval.mockResolvedValueOnce([0, 0]);
      // Pacing: allowed [0, 0]
      mockRedis.eval.mockResolvedValueOnce([0, 0]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);
      expect(mockRedis.decr).not.toHaveBeenCalled();
    });

    it('should block send when hourly limit is reached and return retryAfterMs', async () => {
      // Hourly: blocked [1, 1800] (1800 seconds remaining)
      mockRedis.eval.mockResolvedValueOnce([1, 1800]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(1800 * 1000);
      expect(result.reason).toContain('Hourly rate limit reached');
      // Should NOT proceed to pacing check
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      expect(mockRedis.decr).not.toHaveBeenCalled();
    });

    it('should enforce minimum 1000ms delay when hourly TTL is small', async () => {
      // Hourly: blocked [1, 0] (less than 1s remaining)
      mockRedis.eval.mockResolvedValueOnce([1, 0]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(1000); // Math.max(0, 1000)
    });

    it('should block and roll back hourly count when pacing interval is active', async () => {
      // Hourly: allowed [0, 0]
      mockRedis.eval.mockResolvedValueOnce([0, 0]);
      // Pacing: blocked [1, 650] (650ms remaining on pacing lock)
      mockRedis.eval.mockResolvedValueOnce([1, 650]);

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(650);
      expect(result.reason).toContain('Send pacing: minimum');
      // Must roll back the hourly reservation so blocked job does not consume capacity
      expect(mockRedis.decr).toHaveBeenCalledTimes(1);
    });

    it('should enforce minimum 100ms delay for pacing deferral', async () => {
      mockRedis.eval.mockResolvedValueOnce([0, 0]);
      mockRedis.eval.mockResolvedValueOnce([1, 20]); // 20ms remaining

      const result = await limiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(100); // Math.max(20, 100)
    });

    it('should fail safely if Redis throws during hourly check without sending', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('Redis connection lost'));

      await expect(limiter.acquireSendSlot('user-1')).rejects.toThrow('Redis connection lost');
      expect(mockRedis.decr).not.toHaveBeenCalled();
    });

    it('should fail safely if Redis throws during pacing check', async () => {
      mockRedis.eval.mockResolvedValueOnce([0, 0]);
      mockRedis.eval.mockRejectedValueOnce(new Error('Redis timeout'));

      await expect(limiter.acquireSendSlot('user-1')).rejects.toThrow('Redis timeout');
    });
  });

  describe('Scope Configuration: global vs per-sender', () => {
    it('should use global key prefix when scope is global', async () => {
      const globalLimiter = new DistributedRateLimiter(mockRedis as unknown as Redis, {
        scope: 'global',
        prefix: 'test-prefix',
      });
      mockRedis.eval.mockResolvedValue([0, 0]);

      await globalLimiter.acquireSendSlot('user-123');

      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        1,
        'test-prefix:hourly:global',
        expect.any(String)
      );
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        1,
        'test-prefix:pace:global',
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
        1,
        'test-prefix:hourly:user:user-abc',
        expect.any(String)
      );
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        1,
        'test-prefix:pace:user:user-abc',
        expect.any(String)
      );

      // Second sender is isolated to its own user key
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        3,
        expect.any(String),
        1,
        'test-prefix:hourly:user:user-xyz',
        expect.any(String)
      );
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        4,
        expect.any(String),
        1,
        'test-prefix:pace:user:user-xyz',
        expect.any(String)
      );
    });

    it('should skip pacing check when intervalMs is 0', async () => {
      const unpacedLimiter = new DistributedRateLimiter(mockRedis as unknown as Redis, {
        intervalMs: 0,
      });
      mockRedis.eval.mockResolvedValueOnce([0, 0]); // Hourly check

      const result = await unpacedLimiter.acquireSendSlot('user-1');

      expect(result.allowed).toBe(true);
      // Only 1 eval call for hourly, pacing was skipped
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe('Concurrent Workers Simulation', () => {
    it('should coordinate atomic slot acquisition across concurrent worker calls', async () => {
      let hourlyCounter = 0;
      let pacingActive = false;

      // Realistic mock representing atomic Redis state across concurrent workers
      mockRedis.eval.mockImplementation(async (_script: string, _numKeys: number, key: string) => {
        if (key.includes(':hourly:')) {
          hourlyCounter++;
          // Say limit is 3: first 3 pass, 4th and beyond are denied
          if (hourlyCounter > 3) {
            return [1, 3600]; // Denied by hourly limit
          }
          return [0, 0]; // Allowed
        }

        if (key.includes(':pace:')) {
          if (pacingActive) {
            return [1, 1000]; // Denied by pacing interval lock
          }
          pacingActive = true; // Lock pacing for first caller
          return [0, 0]; // Allowed
        }

        return [0, 0];
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

      // Exactly ONE worker should acquire the slot because of pacing interval
      expect(allowedCount).toBe(1);
      expect(deniedCount).toBe(3);

      // Denied workers should have proper retry times and reasons
      const denied = results.filter((r) => !r.allowed);
      for (const d of denied) {
        expect(d.retryAfterMs).toBeGreaterThan(0);
        expect(d.reason).toBeDefined();
      }

      // Rollback was called for workers that passed hourly but got blocked by pacing
      expect(mockRedis.decr).toHaveBeenCalled();
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
