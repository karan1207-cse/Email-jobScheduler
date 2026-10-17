/**
 * Distributed Rate Limiter
 *
 * Atomic, cross-process rate limiting and send pacing in one Redis Lua script,
 * so every worker and every instance shares the same counters.
 *
 * Two checks are evaluated atomically, using Redis server time (no clock skew
 * between workers):
 * 1. **Pacing interval** (`PTTL` on `{prefix}:{scope}:pace`):
 *    If an interval is active, returns `{2, pttl_ms}` without touching the
 *    hourly counter, so no capacity can leak.
 *
 * 2. **Hourly limit** (`INCR` on `{prefix}:{scope}:hour:<window>`), where
 *    `<window>` is the clock hour (epoch ms / 3 600 000). If the new count
 *    exceeds `maxPerHour`, it is decremented again and the script returns
 *    `{1, ms_until_next_window, next_window_start_ms}`, so the job is
 *    rescheduled to the start of the next hour window instead of being dropped
 *    or failed. Every deferred job gets the same absolute start time, and BullMQ
 *    keeps jobs with an equal delay timestamp in the order they were deferred,
 *    so the original order is preserved.
 *
 * 3. If both pass, the pacing lock is set with `SET pace_key 1 PX interval_ms`
 *    and the script returns `{0, count_in_window}`.
 *
 * **Redis failure behaviour**: if Redis throws, the error propagates upward.
 * The processor treats it as transient, reverts the DB state, and does NOT
 * send the email, so no unregulated sends occur.
 */
import type { Redis } from 'ioredis';
import { workerConfig } from './config.js';

export const HOUR_MS = 3_600_000;

// ── Atomic Lua Script ────────────────────────────────────────────────────────

export const ATOMIC_RATE_LIMIT_SCRIPT = `
local hourly_base = KEYS[1]
local pacing_key = KEYS[2]
local max_hourly = tonumber(ARGV[1])
local interval_ms = tonumber(ARGV[2])
local hour_ms = 3600000

local t = redis.call('TIME')
local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = math.floor(now_ms / hour_ms)
local ms_until_next = (window + 1) * hour_ms - now_ms

-- 1. Pacing interval first: if active, return without touching the hourly counter.
if interval_ms > 0 then
  local pttl = redis.call('PTTL', pacing_key)
  if pttl > 0 then
    return {2, pttl}
  end
end

-- 2. Hourly limit for the current clock-hour window.
local current = 0
if max_hourly > 0 then
  local hourly_key = hourly_base .. ':' .. window
  current = redis.call('INCR', hourly_key)
  if current == 1 then
    -- Keep the counter one extra hour for monitoring, then let it expire.
    redis.call('PEXPIRE', hourly_key, ms_until_next + hour_ms)
  end
  if current > max_hourly then
    redis.call('DECR', hourly_key)
    return {1, ms_until_next, (window + 1) * hour_ms}
  end
end

-- 3. Both checks passed: set the pacing lock.
if interval_ms > 0 then
  redis.call('SET', pacing_key, '1', 'PX', interval_ms)
end

return {0, current}
`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  /** 'hourly' when the hourly quota is used up, 'pacing' when the min interval is active. */
  limitType?: 'hourly' | 'pacing';
  /** When blocked, the number of ms to wait before retrying. */
  retryAfterMs: number;
  /** Absolute time (epoch ms) to retry at, when known: the next hour window start. */
  retryAt?: number;
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
  public readonly redis: Redis;
  private readonly prefix: string;
  public readonly maxPerHour: number;
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
  private keysFor(senderId: string) {
    const scopeTag = this.scope === 'global' ? 'global' : `user:${senderId}`;
    // Redis hash-tags `{...}` keep both keys in the same slot in Redis Cluster.
    return {
      scopeTag,
      hourlyBase: `${this.prefix}:{${scopeTag}}:hour`,
      pacingKey: `${this.prefix}:{${scopeTag}}:pace`,
    };
  }

  /** 'global' for a shared limit, otherwise the sender this limit applies to. */
  scopeFor(senderId: string): string {
    return this.scope === 'global' ? 'global' : senderId;
  }

  /**
   * Attempt to acquire a send slot for the given sender.
   * Checks both pacing interval and hourly limit atomically in a single Redis script.
   */
  async acquireSendSlot(senderId: string): Promise<RateLimitResult> {
    const { hourlyBase, pacingKey } = this.keysFor(senderId);

    const result = (await this.redis.eval(
      ATOMIC_RATE_LIMIT_SCRIPT,
      2,
      hourlyBase,
      pacingKey,
      String(this.maxPerHour),
      String(this.intervalMs)
    )) as [number, number, number?];

    // Status 1: Hourly limit reached; result[1] = ms until the next hour window
    if (result[0] === 1) {
      const retryAfterMs = Math.max(result[1], 1000); // At least 1s
      return {
        allowed: false,
        limitType: 'hourly',
        retryAfterMs,
        retryAt: result[2],
        reason: `Hourly rate limit reached (${this.maxPerHour}/hr). Rescheduled to the next hour window in ${Math.ceil(retryAfterMs / 1000)}s.`,
      };
    }

    // Status 2: Pacing interval active
    if (result[0] === 2) {
      const retryAfterMs = result[1]; // Already in ms
      return {
        allowed: false,
        limitType: 'pacing',
        retryAfterMs: Math.max(retryAfterMs, 100), // At least 100ms
        reason: `Send pacing: minimum ${this.intervalMs}ms between sends. Retry after ${retryAfterMs}ms.`,
      };
    }

    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * Get current hourly usage (this clock hour) for monitoring/debugging.
   */
  async getCurrentHourlyCount(senderId: string, now: number = Date.now()): Promise<number> {
    const { hourlyBase } = this.keysFor(senderId);
    const val = await this.redis.get(`${hourlyBase}:${Math.floor(now / HOUR_MS)}`);
    return val ? parseInt(val, 10) : 0;
  }
}
