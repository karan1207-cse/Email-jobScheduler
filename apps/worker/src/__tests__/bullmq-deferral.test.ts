/**
 * Audit Regression Test: BullMQ Delayed Job Contract (Audit A)
 *
 * Verifies that RateLimitDeferralError satisfies BullMQ's exact internal
 * DelayedError contract (worker.ts handleFailed).
 *
 * Context:
 * In BullMQ, if a job processor moves a job to delayed via job.moveToDelayed()
 * and then throws an ordinary Error, BullMQ's worker.handleFailed() will catch it
 * and execute:
 *   await job.moveToFailed(err, token, fetchNext);
 *   this.emit('failed', job, err, 'active');
 *
 * This causes a destructive race: the job in Redis is active-delayed, but
 * moveToFailed attempts to transition it to failed, emitting a false failure
 * and consuming a retry attempt.
 *
 * When an error matches `err instanceof DelayedError || err.name === 'DelayedError'`,
 * BullMQ skips moveToFailed and skips emitting 'failed', cleanly acknowledging the
 * delayed transition without retry penalties.
 */
import { describe, it, expect } from 'vitest';
import { DelayedError } from 'bullmq';
import { RateLimitDeferralError } from '../processor.js';

describe('Audit A — BullMQ DelayedError Contract Verification', () => {
  it('should inherit from BullMQ DelayedError', () => {
    const error = new RateLimitDeferralError(5000, 'Rate limit test');
    expect(error instanceof DelayedError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });

  it('should have name equal to "DelayedError" for BullMQ duck-typing check', () => {
    const error = new RateLimitDeferralError(3600000, 'Hourly limit reached');
    expect(error.name).toBe('DelayedError');
  });

  it('should expose retryAfterMs and reason metadata', () => {
    const error = new RateLimitDeferralError(1500, 'Send pacing active');
    expect(error.retryAfterMs).toBe(1500);
    expect(error.reason).toBe('Send pacing active');
    expect(error.message).toContain('Send pacing active');
  });

  it('should satisfy BullMQ handleFailed guard predicate', () => {
    // BullMQ's actual guard from classes/worker.js line 357:
    const isBullMQDelayed = (err: unknown): boolean => {
      const e = err as { name?: string };
      return (
        err instanceof DelayedError ||
        e.name === 'DelayedError'
      );
    };

    const deferralError = new RateLimitDeferralError(1000, 'Pacing');
    const genericError = new Error('SMTP connection refused');

    // Deferral error must match
    expect(isBullMQDelayed(deferralError)).toBe(true);

    // Standard errors must NOT match
    expect(isBullMQDelayed(genericError)).toBe(false);
  });
});
