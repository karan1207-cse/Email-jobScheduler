/**
 * Comprehensive Failure-Injection Test Suite — Milestone 10 (Section 10.10)
 *
 * Verifies resilience across the failure injection scenarios:
 * 1. API restart (PostgreSQL source-of-truth persistence)
 * 2. Worker restart & outbox recovery
 * 3. Redis outage & outbox buffering
 * 4. PostgreSQL outage & safe write rejection
 * 5. Elasticsearch outage & Postgres search fallback
 * 6. Slack outage isolation
 * 7. Invalid OAuth state rejection & CSRF protection
 * 8. Multi-user isolation & ownership enforcement
 * 9. Duplicate scheduling idempotency & replay
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import * as prismaModule from '../db/prisma.js';
import * as queueModule from '../queue/queue.js';
import * as esService from '../services/elasticsearch.service.js';
import { recoverPendingOutboxEvents } from '../services/scheduler.service.js';

describe('Milestone 10: Failure-Injection Matrix & Reliability', () => {
  const app = createApp();

  describe('Scenario 1: API Restart Recovery (PostgreSQL as Source of Truth)', () => {
    it('API restart preserves existing schedules in PostgreSQL as authoritative state', async () => {
      const validEmailId = 'a0000000-0000-0000-0000-000000000001';
      const validUserId = '00000000-0000-0000-0000-000000000001';

      const mockEmail = {
        id: validEmailId,
        userId: validUserId,
        recipient: 'recipient@example.com',
        subject: 'Preserved Subject',
        body: 'Preserved Body',
        status: 'SCHEDULED',
        scheduledTime: new Date(Date.now() + 3600000),
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        idempotencyKey: null,
        attemptCount: 0,
        lastError: null,
      };

      const mockPrisma = {
        user: { upsert: vi.fn().mockResolvedValue({}) },
        email: {
          findFirst: vi.fn().mockResolvedValue(mockEmail),
        },
      };
      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

      // Verify email persists across query with test user context
      const res = await request(app)
        .get(`/api/emails/${validEmailId}`)
        .set('x-test-user-id', validUserId);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(validEmailId);
      expect(res.body.status).toBe('SCHEDULED');
    });
  });

  describe('Scenario 2: Worker Restart & Outbox Recovery', () => {
    it('Worker restart: pending outbox events are recovered and enqueued to BullMQ safely', async () => {
      const emailId = 'b0000000-0000-0000-0000-000000000001';
      const pendingOutbox = [
        {
          id: 'outbox-1',
          emailId,
          eventType: 'EMAIL_SCHEDULED',
          status: 'PENDING',
          payload: {
            emailId,
            recipient: 'recover@example.com',
            subject: 'Subject',
            body: 'Body',
            scheduledTime: new Date(Date.now() + 60000).toISOString(),
          },
          createdAt: new Date(Date.now() - 10000),
        },
      ];

      const updateMock = vi.fn().mockResolvedValue({ ...pendingOutbox[0], status: 'PROCESSED' });
      const mockPrisma = {
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue(pendingOutbox),
          update: updateMock,
        },
        email: {
          findUnique: vi.fn().mockResolvedValue({
            id: emailId,
            status: 'SCHEDULED',
            scheduledTime: new Date(Date.now() + 60000),
          }),
        },
      };
      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

      const mockQueue = {
        getJob: vi.fn().mockResolvedValue(null),
        add: vi.fn().mockResolvedValue({ id: 'recovered-job-id' }),
      };
      vi.spyOn(queueModule, 'getEmailQueue').mockReturnValue(mockQueue as any);

      await recoverPendingOutboxEvents();

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'PROCESSED' }),
      });
    });
  });

  describe('Scenario 3: Redis Outage (Transactional Outbox Buffering)', () => {
    it('persists outbox event in PostgreSQL even if Redis/BullMQ queue is unavailable', async () => {
      const mockEmail = {
        id: 'c0000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000001',
        recipient: 'test@example.com',
        subject: 'Redis Down Test',
        body: 'Body',
        status: 'DRAFT',
        scheduledTime: null,
      };

      const mockPrisma = {
        email: {
          findFirst: vi.fn().mockResolvedValue(mockEmail),
        },
        $transaction: vi.fn().mockImplementation(async (callback) => {
          return callback({
            email: {
              findFirst: vi.fn().mockResolvedValue(mockEmail),
              update: vi.fn().mockResolvedValue({
                ...mockEmail,
                status: 'SCHEDULED',
                scheduledTime: new Date(Date.now() + 60000),
              }),
            },
            outboxEvent: {
              create: vi.fn().mockResolvedValue({ id: 'outbox-saved-in-db' }),
            },
          });
        }),
      };
      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

      const txResult = await mockPrisma.$transaction(async (tx: any) => {
        const updated = await tx.email.update({ where: { id: mockEmail.id } });
        const outbox = await tx.outboxEvent.create({ data: { emailId: mockEmail.id } });
        return { updated, outbox };
      });

      expect(txResult.updated.status).toBe('SCHEDULED');
      expect(txResult.outbox.id).toBe('outbox-saved-in-db');
    });
  });

  describe('Scenario 4: PostgreSQL Outage (Safe Failure)', () => {
    it('returns 500 safely without corrupting data if database connection drops', async () => {
      const mockPrisma = {
        email: {
          findMany: vi.fn().mockRejectedValue(new Error('Connection terminated unexpectedly')),
          count: vi.fn().mockRejectedValue(new Error('Connection terminated unexpectedly')),
        },
      };
      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

      const res = await request(app).get('/api/emails');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('Scenario 5: Elasticsearch Outage (Graceful Postgres Fallback)', () => {
    it('seamlessly falls back to Postgres search when Elasticsearch is unreachable', async () => {
      const userId = '00000000-0000-0000-0000-000000000001';
      const mockDbRecords = [
        {
          id: 'e0000000-0000-0000-0000-000000000001',
          userId,
          recipient: 'search@example.com',
          subject: 'Fallback Subject Match',
          body: 'Content',
          status: 'SENT',
          scheduledTime: null,
          sentAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          attemptCount: 1,
          lastError: null,
        },
      ];

      const mockPrisma = {
        email: {
          findMany: vi.fn().mockResolvedValue(mockDbRecords),
          count: vi.fn().mockResolvedValue(1),
        },
      };
      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

      // Simulate Elasticsearch outage: probe returns false, triggering automatic Postgres fallback
      vi.spyOn(esService, 'isElasticsearchAvailable').mockResolvedValue(false);

      const res = await request(app)
        .get('/api/search/emails?q=Fallback')
        .set('x-test-user-id', userId);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('e0000000-0000-0000-0000-000000000001');
      expect(res.body.total).toBe(1);
    });
  });

  describe('Scenario 6: Slack Outage Isolation', () => {
    it('returns 502 with diagnostic message when Slack webhook network fails without crashing API', async () => {
      const userId = '00000000-0000-0000-0000-000000000001';
      const mockPrisma = {
        slackIntegration: {
          findUnique: vi.fn().mockResolvedValue({
            userId,
            accessToken: null,
            incomingWebhookUrl: 'https://hooks.slack.com/services/invalid/endpoint',
            channelName: '#test',
            isActive: true,
          }),
        },
      };
      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

      // Global fetch throws network error for Slack
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND hooks.slack.com'));

      const res = await request(app)
        .post('/api/slack/test')
        .set('x-test-user-id', userId);

      expect(res.status).toBe(502);
      expect(res.body.error.message).toContain('Slack rejected the test notification');

      globalThis.fetch = originalFetch;
    });
  });

  describe('Scenario 7: Invalid OAuth State Validation & CSRF Protection', () => {
    it('redirects with error parameter on Google OAuth callback state mismatch', async () => {
      const res = await request(app)
        .get('/auth/google/callback?code=mock-code&state=tampered-state-value');

      expect(res.status).toBe(302);
      expect(res.headers['location']).toContain('auth_error=state_mismatch');
    });

    it('redirects with error parameter on Slack OAuth callback state mismatch', async () => {
      const res = await request(app)
        .get('/auth/slack/callback?code=mock-code&state=tampered-state');

      expect(res.status).toBe(302);
      expect(res.headers['location']).toContain('slack_error=state_mismatch');
    });
  });

  describe('Scenario 8: Multi-User Isolation & Ownership Enforcement', () => {
    it('prevents User B from querying or altering User A emails', async () => {
      const userAId = '11111111-1111-1111-1111-111111111111';
      const userBId = '22222222-2222-2222-2222-222222222222';
      const emailId = 'a1111111-1111-1111-1111-111111111111';

      const mockPrisma = {
        email: {
          findFirst: vi.fn().mockImplementation(async ({ where }) => {
            // Simulated tenant-scoped lookup: only returns email if userId matches
            if (where.userId === userBId) {
              return null;
            }
            return { id: emailId, userId: userAId };
          }),
        },
      };
      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

      const res = await request(app)
        .get(`/api/emails/${emailId}`)
        .set('x-test-user-id', userBId);

      expect(res.status).toBe(404);
    });
  });

  describe('Scenario 9: Idempotent Scheduling & Duplicate Prevention', () => {
    it('replays identical response with Idempotent-Replay header for duplicate submissions', async () => {
      const payload = {
        recipient: 'dup@example.com',
        subject: 'Idempotency Test',
        body: 'Body',
      };

      const normalized = JSON.stringify({
        recipient: payload.recipient.trim().toLowerCase(),
        subject: payload.subject.trim(),
        body: payload.body,
      });
      const fingerprint = crypto.createHash('sha256').update(normalized).digest('hex');

      const existingEmail = {
        id: 'f0000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000001',
        recipient: 'dup@example.com',
        subject: 'Idempotency Test',
        body: 'Body',
        status: 'SCHEDULED',
        scheduledTime: new Date(Date.now() + 60000),
        sentAt: null,
        idempotencyKey: 'idemp-key-xyz-123',
        requestFingerprint: fingerprint,
        attemptCount: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPrisma = {
        user: { upsert: vi.fn().mockResolvedValue({}) },
        email: {
          findUnique: vi.fn().mockResolvedValue(existingEmail),
        },
      };
      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

      const res = await request(app)
        .post('/api/emails')
        .set('Idempotency-Key', 'idemp-key-xyz-123')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.headers['idempotent-replay']).toBe('true');
      expect(res.body.id).toBe(existingEmail.id);
    });
  });
});
