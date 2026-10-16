/**
 * Distributed Rate Limiter — Milestone 4
 *
 * Implements atomic, cross-process rate limiting using Redis Lua scripts.
 * Two independent checks are performed before each send:
 *
 * 1. **Hourly limit** — Fixed-window counter with TTL-based expiry.
 *    Key: `{prefix}:hourly:{scope}` where scope is `global` or `user:{userId}`.
 *    A Lua script atomically increments the counter; if this is the first
 *    increment in the window it also sets a 3600s TTL. If the new count
 *    exceeds the configured maximum the script decrements and returns the
 *    remaining TTL so the caller can compute a retry-after delay.
 *
 * 2. **Minimum interval (pacing)** — Uses `SET key 1 NX PX <ms>`.
 *    Key: `{prefix}:pace:{scope}`.
 *    If the SET succeeds, the interval is free. If it fails the script
 *    returns the remaining TTL on the key so the caller knows how long
 *    to wait.
 *
 * Both checks are combined in a single `acquireSendSlot()` call that
 * returns either `{ allowed: true }` or `{ allowed: false, retryAfterMs }`.
 *
 * **Redis failure behaviour**: if the Lua call throws, the error propagates
 * upward. The processor treats this as a transient failure and does NOT
 * bypass rate limiting — no unregulated sends can occur.
 */
import type { Redis } from 'ioredis';
import { workerConfig } from './config.js';

// ── Lua Scripts ──────────────────────────────────────────────────────────────

/**
 * HOURLY_LIMIT_SCRIPT
 * KEYS[1] = hourly counter key
 * ARGV[1] = max allowed count per hour
 *
 * Returns: { 0 = allowed, 1 = blocked } , remaining_ttl_seconds
 *
 * Atomically:
 *   INCR key → if first increment → EXPIRE key 3600
 *   if count > max → DECR key → return {1, ttl}
 *   else → return {0, 0}
 */
const HOURLY_LIMIT_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])

local current = redis.call('INCR', key)

if current == 1 then
  redis.call('EXPIRE', key, 3600)
end

if current > max then
  redis.call('DECR', key)
  local ttl = redis.call('TTL', key)
  if ttl < 0 then ttl = 3600 end
  return {1, ttl}
end

return {0, 0}
`;

/**
 * PACING_SCRIPT
 * KEYS[1] = pacing key
 * ARGV[1] = interval in milliseconds
 *
 * Returns: { 0 = allowed, 1 = blocked } , remaining_ttl_ms
 *
 * Atomically:
 *   SET key 1 NX PX intervalMs
 *   if SET succeeded → return {0, 0}
 *   else → PTTL key → return {1, pttl}
 */
const PACING_SCRIPT = `
local key = KEYS[1]
local interval_ms = tonumber(ARGV[1])

local ok = redis.call('SET', key, '1', 'NX', 'PX', interval_ms)

if ok then
  return {0, 0}
end

local pttl = redis.call('PTTL', key)
if pttl < 0 then pttl = interval_ms end
return {1, pttl}
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
   * Both the hourly limit and pacing interval must pass.
   * If either blocks, the slot is NOT consumed and `retryAfterMs` is returned.
   */
  async acquireSendSlot(senderId: string): Promise<RateLimitResult> {
    const scopeKey = this.scope === 'global' ? 'global' : `user:${senderId}`;

    // 1. Check hourly limit first (cheaper to check; pacing slot should not
    //    be consumed if the hourly limit would block).
    const hourlyKey = `${this.prefix}:hourly:${scopeKey}`;
    const hourlyResult = (await this.redis.eval(
      HOURLY_LIMIT_SCRIPT,
      1,
      hourlyKey,
      String(this.maxPerHour)
    )) as [number, number];

    if (hourlyResult[0] === 1) {
      const retryAfterMs = hourlyResult[1] * 1000; // TTL is in seconds
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfterMs, 1000), // At least 1s
        reason: `Hourly rate limit reached (${this.maxPerHour}/hr). Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
      };
    }

    // 2. Check pacing interval
    if (this.intervalMs > 0) {
      const pacingKey = `${this.prefix}:pace:${scopeKey}`;
      const pacingResult = (await this.redis.eval(
        PACING_SCRIPT,
        1,
        pacingKey,
        String(this.intervalMs)
      )) as [number, number];

      if (pacingResult[0] === 1) {
        // Pacing blocked — we already incremented the hourly counter, so
        // we must decrement it to avoid consuming a slot without sending.
        await this.redis.decr(hourlyKey);

        const retryAfterMs = pacingResult[1]; // Already in ms
        return {
          allowed: false,
          retryAfterMs: Math.max(retryAfterMs, 100), // At least 100ms
          reason: `Send pacing: minimum ${this.intervalMs}ms between sends. Retry after ${retryAfterMs}ms.`,
        };
      }
    }

    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * Get current hourly usage for monitoring/debugging.
   */
  async getCurrentHourlyCount(senderId: string): Promise<number> {
    const scopeKey = this.scope === 'global' ? 'global' : `user:${senderId}`;
    const hourlyKey = `${this.prefix}:hourly:${scopeKey}`;
    const val = await this.redis.get(hourlyKey);
    return val ? parseInt(val, 10) : 0;
  }
}
