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
  validateSmtpConfig,
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
      expect(() => parseRateLimitScope('')).toThrow(
        /RATE_LIMIT_SCOPE must be 'global' or 'per-sender'/
      );
    });
  });

  describe('validateSmtpConfig', () => {
    const validDevConfig = {
      NODE_ENV: 'development',
      SMTP_HOST: '',
      SMTP_PORT: 587,
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: 'noreply@reachinbox.local',
    };

    it('should allow empty SMTP credentials in development (Ethereal fallback)', () => {
      expect(() => validateSmtpConfig(validDevConfig)).not.toThrow();
    });

    it('should allow full SMTP configuration in any environment', () => {
      const fullConfig = {
        ...validDevConfig,
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.sendgrid.net',
        SMTP_PORT: 465,
        SMTP_USER: 'apikey',
        SMTP_PASS: 'secret123',
      };
      expect(() => validateSmtpConfig(fullConfig)).not.toThrow();
    });

    it('should reject invalid SMTP_PORT', () => {
      expect(() => validateSmtpConfig({ ...validDevConfig, SMTP_PORT: 0 })).toThrow(
        /SMTP_PORT must be between 1 and 65535/
      );
      expect(() => validateSmtpConfig({ ...validDevConfig, SMTP_PORT: 70000 })).toThrow(
        /SMTP_PORT must be between 1 and 65535/
      );
    });

    it('should reject partial SMTP configuration', () => {
      expect(() =>
        validateSmtpConfig({ ...validDevConfig, SMTP_HOST: 'smtp.example.com', SMTP_USER: '' })
      ).toThrow(/Partial SMTP configuration/);

      expect(() =>
        validateSmtpConfig({
          ...validDevConfig,
          SMTP_HOST: 'smtp.example.com',
          SMTP_USER: 'user',
          SMTP_PASS: '',
        })
      ).toThrow(/Partial SMTP configuration/);
    });

    it('should reject missing SMTP credentials in production mode', () => {
      expect(() => validateSmtpConfig({ ...validDevConfig, NODE_ENV: 'production' })).toThrow(
        /Production environment requires real SMTP configuration/
      );
    });

    it('should reject empty SMTP_FROM', () => {
      expect(() => validateSmtpConfig({ ...validDevConfig, SMTP_FROM: '   ' })).toThrow(
        /SMTP_FROM cannot be empty/
      );
    });
  });
});
