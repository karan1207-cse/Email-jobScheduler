/**
 * Unit tests for Worker Configuration Validation (Milestone 4)
 * Verifies that invalid, negative, or nonsensical environment values
 * are rejected, and valid defaults and values are accepted.
 */
import { describe, it, expect } from 'vitest';
import {
  required,
  optional,
  positiveInt,
  positiveIntRequired,
  parseRateLimitScope,
} from '../config.js';

describe('Worker Config Validation', () => {
  describe('required', () => {
    it('should return value when present', () => {
      expect(required('TEST_VAR', { TEST_VAR: 'hello' })).toBe('hello');
    });

    it('should throw when variable is missing', () => {
      expect(() => required('MISSING_VAR', {})).toThrow(
        /Missing required environment variable: MISSING_VAR/
      );
    });

    it('should throw when variable is empty string', () => {
      expect(() => required('EMPTY_VAR', { EMPTY_VAR: '' })).toThrow(
        /Missing required environment variable: EMPTY_VAR/
      );
    });
  });

  describe('optional', () => {
    it('should return value when present', () => {
      expect(optional('MY_VAR', 'fallback', { MY_VAR: 'val' })).toBe('val');
    });

    it('should return fallback when absent', () => {
      expect(optional('NOT_SET', 'default-val', {})).toBe('default-val');
    });
  });

  describe('positiveInt', () => {
    it('should parse valid positive integer', () => {
      expect(positiveInt('RATE_LIMIT_MAX_PER_HOUR', 100, { RATE_LIMIT_MAX_PER_HOUR: '250' })).toBe(250);
    });

    it('should allow 0 (for disabling limits)', () => {
      expect(positiveInt('RATE_LIMIT_INTERVAL_MS', 1000, { RATE_LIMIT_INTERVAL_MS: '0' })).toBe(0);
    });

    it('should return fallback when not set', () => {
      expect(positiveInt('UNSET_INT', 42, {})).toBe(42);
    });

    it('should throw on negative numbers', () => {
      expect(() =>
        positiveInt('RATE_LIMIT_MAX_PER_HOUR', 100, { RATE_LIMIT_MAX_PER_HOUR: '-50' })
      ).toThrow(/must be a non-negative integer/);
    });

    it('should throw on non-numeric strings', () => {
      expect(() =>
        positiveInt('RATE_LIMIT_INTERVAL_MS', 1000, { RATE_LIMIT_INTERVAL_MS: 'abc' })
      ).toThrow(/must be a non-negative integer/);
    });
  });

  describe('positiveIntRequired', () => {
    it('should parse positive integer > 0', () => {
      expect(positiveIntRequired('WORKER_CONCURRENCY', 5, { WORKER_CONCURRENCY: '10' })).toBe(10);
    });

    it('should reject 0 when concurrency cannot be zero', () => {
      expect(() =>
        positiveIntRequired('WORKER_CONCURRENCY', 5, { WORKER_CONCURRENCY: '0' })
      ).toThrow(/must be a positive integer/);
    });

    it('should reject negative concurrency', () => {
      expect(() =>
        positiveIntRequired('WORKER_CONCURRENCY', 5, { WORKER_CONCURRENCY: '-1' })
      ).toThrow(/must be a non-negative integer/);
    });
  });

  describe('parseRateLimitScope', () => {
    it('should accept "global"', () => {
      expect(parseRateLimitScope('global')).toBe('global');
      expect(parseRateLimitScope('GLOBAL ')).toBe('global');
    });

    it('should accept "per-sender"', () => {
      expect(parseRateLimitScope('per-sender')).toBe('per-sender');
      expect(parseRateLimitScope(' PER-SENDER')).toBe('per-sender');
    });

    it('should reject invalid scopes', () => {
      expect(() => parseRateLimitScope('invalid-scope')).toThrow(
        /RATE_LIMIT_SCOPE must be 'global' or 'per-sender'/
      );
      expect(() => parseRateLimitScope('user')).toThrow(
        /RATE_LIMIT_SCOPE must be 'global' or 'per-sender'/
      );
      expect(() => parseRateLimitScope('')).toThrow(
        /RATE_LIMIT_SCOPE must be 'global' or 'per-sender'/
      );
    });
  });
});
