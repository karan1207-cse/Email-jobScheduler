/**
 * Distributed Rate Limiter — Milestone 4
 *
 * Implements atomic, cross-process rate limiting and send pacing using a single
 * Redis Lua script to guarantee zero race conditions, zero quota leaks, and no worker sleeping.
 *
 * Two checks are evaluated atomically:
 * 1. **Pacing interval** (`PTTL` on `{prefix}:{scope}:pace`):
 *    If an interval is active, returns `{2, pttl_ms}` immediately without touching
 *    the hourly counter. No rollback is needed and no capacity can leak.
 *
 * 2. **Hourly limit** (`INCR` on `{prefix}:{scope}:hourly`):
 *    If pacing is clear, atomically increments the hourly counter. If new count
 *    exceeds `maxPerHour`, decrements immediately and returns `{1, ttl_seconds}`.
 *
 * 3. If both pass:
 *    The pacing lock is set with `SET pace_key 1 PX interval_ms` and returns `{0, 0}`.
 *
 * **Redis failure behaviour**: if Redis throws, the error propagates upward.
 * The processor treats it as transient, reverts the DB state, and does NOT
 * send the email — ensuring no unregulated sends occur.
 */
import type { Redis } from 'ioredis';
import { workerConfig } from './config.js';

// ── Atomic Lua Script ────────────────────────────────────────────────────────

const ATOMIC_RATE_LIMIT_SCRIPT = `
local hourly_key = KEYS[1]
local pacing_key = KEYS[2]
local max_hourly = tonumber(ARGV[1])
local interval_ms = tonumber(ARGV[2])

-- 1. Check pacing interval first (if pacing is enabled)
-- If pacing is active, return immediately without touching hourly counter.
if interval_ms > 0 then
  local pttl = redis.call('PTTL', pacing_key)
  if pttl > 0 then
    return {2, pttl}
  end
end

-- 2. Check hourly limit (if hourly limit is enabled)
if max_hourly > 0 then
  local current = redis.call('INCR', hourly_key)
  if current == 1 then
    redis.call('EXPIRE', hourly_key, 3600)
  end
  if current > max_hourly then
    redis.call('DECR', hourly_key)
    local ttl = redis.call('TTL', hourly_key)
    if ttl < 0 then ttl = 3600 end
    return {1, ttl}
  end
end

-- 3. Both checks passed: set pacing lock key atomically
if interval_ms > 0 then
  redis.call('SET', pacing_key, '1', 'PX', interval_ms)
end

return {0, 0}
`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  /** When blocked, the number of ms to wait before retrying. */
  retryAfterMs: number;
  /** Human-readable reason for blocking. */
  reason?: string;
}

export interface RateLimiterOptions {
  prefix?: string;
  maxPerHour?: number;
  intervalMs?: number;
  scope?: 'global' | 'per-sender';
}

// ── Rate Limiter Class ───────────────────────────────────────────────────────

export class DistributedRateLimiter {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly maxPerHour: number;
  private readonly intervalMs: number;
  private readonly scope: 'global' | 'per-sender';

  constructor(redis: Redis, options?: RateLimiterOptions) {
    this.redis = redis;
    this.prefix = options?.prefix ?? workerConfig.RATE_LIMIT_KEY_PREFIX;
    this.maxPerHour = options?.maxPerHour ?? workerConfig.RATE_LIMIT_MAX_PER_HOUR;
    this.intervalMs = options?.intervalMs ?? workerConfig.RATE_LIMIT_INTERVAL_MS;
    this.scope = options?.scope ?? workerConfig.RATE_LIMIT_SCOPE;
  }

  /**
   * Attempt to acquire a send slot for the given sender.
   * Checks both pacing interval and hourly limit atomically in a single Redis script.
   */
  async acquireSendSlot(senderId: string): Promise<RateLimitResult> {
    const scopeTag = this.scope === 'global' ? 'global' : `user:${senderId}`;
    // Using Redis hash-tags `{...}` ensures both keys map to the same hash slot in Redis Cluster
    const hourlyKey = `${this.prefix}:{${scopeTag}}:hourly`;
    const pacingKey = `${this.prefix}:{${scopeTag}}:pace`;

    const result = (await this.redis.eval(
      ATOMIC_RATE_LIMIT_SCRIPT,
      2,
      hourlyKey,
      pacingKey,
      String(this.maxPerHour),
      String(this.intervalMs)
    )) as [number, number];

    // Status 1: Hourly limit reached
    if (result[0] === 1) {
      const retryAfterMs = result[1] * 1000; // TTL is in seconds
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfterMs, 1000), // At least 1s
        reason: `Hourly rate limit reached (${this.maxPerHour}/hr). Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
      };
    }

    // Status 2: Pacing interval active
    if (result[0] === 2) {
      const retryAfterMs = result[1]; // Already in ms
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfterMs, 100), // At least 100ms
        reason: `Send pacing: minimum ${this.intervalMs}ms between sends. Retry after ${retryAfterMs}ms.`,
      };
    }

    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * Get current hourly usage for monitoring/debugging.
   */
  async getCurrentHourlyCount(senderId: string): Promise<number> {
    const scopeTag = this.scope === 'global' ? 'global' : `user:${senderId}`;
    const hourlyKey = `${this.prefix}:{${scopeTag}}:hourly`;
    const val = await this.redis.get(hourlyKey);
    return val ? parseInt(val, 10) : 0;
  }
}
