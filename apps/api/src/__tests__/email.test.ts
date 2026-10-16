import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import type { Email, OutboxEvent } from '@prisma/client';
import { createApp } from '../app.js';
import * as prismaModule from '../db/prisma.js';
import { createScheduledEmailWithOutbox } from '../services/outbox.service.js';
import { DEV_DEFAULT_USER } from '../services/email.service.js';

describe('ReachInbox Email API & Idempotency (Milestone 2)', () => {
  const app = createApp();

  let emailsStore: Email[] = [];
  let outboxStore: OutboxEvent[] = [];
  let mockPrisma: any;

  function createMockPrisma() {
    return {
      user: {
        upsert: vi.fn().mockImplementation(async ({ create }) => create),
      },
      email: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.userId_idempotencyKey) {
            const { userId, idempotencyKey } = where.userId_idempotencyKey;
            return (
              emailsStore.find(
                (e) => e.userId === userId && e.idempotencyKey === idempotencyKey
              ) || null
            );
          }
          return null;
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            emailsStore.find((e) => {
              if (where.id && e.id !== where.id) return false;
              if (where.userId && e.userId !== where.userId) return false;
              if (where.status && e.status !== where.status) return false;
              return true;
            }) || null
          );
        }),
        findMany: vi.fn().mockImplementation(async ({ where, skip = 0, take = 10 }) => {
          let filtered = emailsStore.filter((e) => {
            if (where?.userId && e.userId !== where.userId) return false;
            if (where?.status && e.status !== where.status) return false;
            return true;
          });
          filtered = filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return filtered.slice(skip, skip + take);
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          return emailsStore.filter((e) => {
            if (where?.userId && e.userId !== where.userId) return false;
            if (where?.status && e.status !== where.status) return false;
            return true;
          }).length;
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newEmail: Email = {
            id: data.id || crypto.randomUUID(),
            userId: data.userId,
            recipient: data.recipient,
            subject: data.subject,
            body: data.body,
            status: data.status || 'DRAFT',
            scheduledTime: data.scheduledTime || null,
            sentAt: data.sentAt || null,
            idempotencyKey: data.idempotencyKey || null,
            requestFingerprint: data.requestFingerprint || null,
            attemptCount: data.attemptCount || 0,
            lastError: data.lastError || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          emailsStore.push(newEmail);
          return newEmail;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const index = emailsStore.findIndex((e) => e.id === where.id);
          if (index === -1) throw new Error('Record not found');
          const updated = {
            ...emailsStore[index]!,
            ...data,
            updatedAt: new Date(),
          };
          emailsStore[index] = updated;
          return updated;
        }),
        delete: vi.fn().mockImplementation(async ({ where }) => {
          const index = emailsStore.findIndex((e) => e.id === where.id);
          if (index === -1) throw new Error('Record not found');
          const deleted = emailsStore[index]!;
          emailsStore.splice(index, 1);
          return deleted;
        }),
      },
      outboxEvent: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const event: OutboxEvent = {
            id: data.id || crypto.randomUUID(),
            eventType: data.eventType,
            aggregateId: data.aggregateId,
            payload: data.payload,
            status: data.status || 'PENDING',
            attemptCount: data.attemptCount || 0,
            lastError: data.lastError || null,
            processedAt: null,
            createdAt: new Date(),
          };
          outboxStore.push(event);
          return event;
        }),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        const emailsSnapshot = [...emailsStore];
        const outboxSnapshot = [...outboxStore];
        try {
          return await callback(mockPrisma);
        } catch (err) {
          emailsStore = emailsSnapshot;
          outboxStore = outboxSnapshot;
          throw err;
        }
      }),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    emailsStore = [];
    outboxStore = [];
    mockPrisma = createMockPrisma();
    vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma);
  });

  describe('POST /api/emails (Create Draft)', () => {
    it('should create a draft email with valid input', async () => {
      const res = await request(app)
        .post('/api/emails')
        .send({
          recipient: 'alice@example.com',
          subject: 'Welcome to ReachInbox',
          body: 'Hello Alice, your account is ready.',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.recipient).toBe('alice@example.com');
      expect(res.body.subject).toBe('Welcome to ReachInbox');
      expect(res.body.body).toBe('Hello Alice, your account is ready.');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.userId).toBe(DEV_DEFAULT_USER.id);
    });

    it('should reject invalid recipient email format with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/emails')
        .send({
          recipient: 'not-an-email',
          subject: 'Test Subject',
          body: 'Test Body',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('message', 'Validation failed');
      expect(res.body.error.details).toBeDefined();
    });

    it('should reject missing required fields with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/emails')
        .send({
          recipient: 'bob@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('message', 'Validation failed');
    });

    it('should reject payload exceeding maximum subject length', async () => {
      const longSubject = 'A'.repeat(501);
      const res = await request(app)
        .post('/api/emails')
        .send({
          recipient: 'bob@example.com',
          subject: longSubject,
          body: 'Valid Body',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].message).toContain('500 characters');
    });
  });

  describe('Idempotency Key Handling', () => {
    it('should return 200 with Idempotent-Replay header when repeating same request with same key', async () => {
      const payload = {
        recipient: 'idempotent@example.com',
        subject: 'Idempotency Test',
        body: 'Testing replay',
      };
      const key = 'idem-unique-key-123';

      // First call -> 201 Created
      const firstRes = await request(app)
        .post('/api/emails')
        .set('Idempotency-Key', key)
        .send(payload);

      expect(firstRes.status).toBe(201);
      expect(firstRes.headers['idempotent-replay']).toBeUndefined();
      const createdId = firstRes.body.id;

      // Second call with identical payload & key -> 200 OK + replay header
      const secondRes = await request(app)
        .post('/api/emails')
        .set('Idempotency-Key', key)
        .send(payload);

      expect(secondRes.status).toBe(200);
      expect(secondRes.headers['idempotent-replay']).toBe('true');
      expect(secondRes.body.id).toBe(createdId);
      expect(emailsStore.length).toBe(1);
    });

    it('should return 409 Conflict when reusing an Idempotency-Key with a different payload', async () => {
      const key = 'idem-conflict-key-999';

      // First call
      await request(app)
        .post('/api/emails')
        .set('Idempotency-Key', key)
        .send({
          recipient: 'user@example.com',
          subject: 'Original Subject',
          body: 'Original Body',
        });

      // Second call with different subject
      const conflictRes = await request(app)
        .post('/api/emails')
        .set('Idempotency-Key', key)
        .send({
          recipient: 'user@example.com',
          subject: 'DIFFERENT Subject',
          body: 'Original Body',
        });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.message).toContain('already used with a different request payload');
      expect(emailsStore.length).toBe(1);
    });
  });

  describe('GET /api/emails (List & Pagination)', () => {
    beforeEach(async () => {
      // Seed 5 emails with different statuses
      for (let i = 1; i <= 5; i++) {
        emailsStore.push({
          id: crypto.randomUUID(),
          userId: DEV_DEFAULT_USER.id,
          recipient: `recipient${i}@example.com`,
          subject: `Email ${i}`,
          body: `Content ${i}`,
          status: i % 2 === 0 ? 'SCHEDULED' : 'DRAFT',
          scheduledTime: null,
          sentAt: null,
          idempotencyKey: null,
          requestFingerprint: null,
          attemptCount: 0,
          lastError: null,
          createdAt: new Date(Date.now() - i * 1000),
          updatedAt: new Date(),
        });
      }
    });

    it('should return paginated list of emails with default limit', async () => {
      const res = await request(app).get('/api/emails?page=1&limit=3');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 3,
        total: 5,
        totalPages: 2,
      });
    });

    it('should filter emails by status', async () => {
      const res = await request(app).get('/api/emails?status=DRAFT');

      expect(res.status).toBe(200);
      expect(res.body.data.every((e: Email) => e.status === 'DRAFT')).toBe(true);
      expect(res.body.pagination.total).toBe(3);
    });
  });

  describe('GET /api/emails/:id', () => {
    it('should return an email by ID', async () => {
      const validUuid = crypto.randomUUID();
      emailsStore.push({
        id: validUuid,
        userId: DEV_DEFAULT_USER.id,
        recipient: 'test@example.com',
        subject: 'Single Email Test',
        body: 'Body content',
        status: 'DRAFT',
        scheduledTime: null,
        sentAt: null,
        idempotencyKey: null,
        requestFingerprint: null,
        attemptCount: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get(`/api/emails/${validUuid}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(validUuid);
    });

    it('should return 400 for malformed UUID parameter', async () => {
      const res = await request(app).get('/api/emails/not-a-valid-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid route parameters');
    });

    it('should return 404 for nonexistent email ID', async () => {
      const nonexistentUuid = crypto.randomUUID();
      const res = await request(app).get(`/api/emails/${nonexistentUuid}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('was not found');
    });
  });

  describe('PATCH /api/emails/:id (Draft Updates)', () => {
    let draftUuid: string;
    let sentUuid: string;

    beforeEach(() => {
      draftUuid = crypto.randomUUID();
      sentUuid = crypto.randomUUID();

      emailsStore.push({
        id: draftUuid,
        userId: DEV_DEFAULT_USER.id,
        recipient: 'draft@example.com',
        subject: 'Original Subject',
        body: 'Original Body',
        status: 'DRAFT',
        scheduledTime: null,
        sentAt: null,
        idempotencyKey: null,
        requestFingerprint: null,
        attemptCount: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      emailsStore.push({
        id: sentUuid,
        userId: DEV_DEFAULT_USER.id,
        recipient: 'sent@example.com',
        subject: 'Sent Subject',
        body: 'Sent Body',
        status: 'SENT',
        scheduledTime: null,
        sentAt: new Date(),
        idempotencyKey: null,
        requestFingerprint: null,
        attemptCount: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should successfully update editable fields of a draft email', async () => {
      const res = await request(app)
        .patch(`/api/emails/${draftUuid}`)
        .send({
          subject: 'Updated Subject Title',
          body: 'Updated body content.',
        });

      expect(res.status).toBe(200);
      expect(res.body.subject).toBe('Updated Subject Title');
      expect(res.body.body).toBe('Updated body content.');
    });

    it('should reject modifying a non-draft email with HTTP 409 Conflict', async () => {
      const res = await request(app)
        .patch(`/api/emails/${sentUuid}`)
        .send({
          subject: 'Attempting to change sent email',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain("Only emails in 'DRAFT' status can be modified");
    });
  });

  describe('DELETE /api/emails/:id', () => {
    let draftUuid: string;
    let scheduledUuid: string;

    beforeEach(() => {
      draftUuid = crypto.randomUUID();
      scheduledUuid = crypto.randomUUID();

      emailsStore.push({
        id: draftUuid,
        userId: DEV_DEFAULT_USER.id,
        recipient: 'draft@example.com',
        subject: 'Draft to delete',
        body: 'Will be deleted',
        status: 'DRAFT',
        scheduledTime: null,
        sentAt: null,
        idempotencyKey: null,
        requestFingerprint: null,
        attemptCount: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      emailsStore.push({
        id: scheduledUuid,
        userId: DEV_DEFAULT_USER.id,
        recipient: 'scheduled@example.com',
        subject: 'Scheduled Email',
        body: 'Cannot delete',
        status: 'SCHEDULED',
        scheduledTime: new Date(Date.now() + 3600000),
        sentAt: null,
        idempotencyKey: null,
        requestFingerprint: null,
        attemptCount: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should delete a draft email and return HTTP 204', async () => {
      const res = await request(app).delete(`/api/emails/${draftUuid}`);

      expect(res.status).toBe(204);
      expect(emailsStore.find((e) => e.id === draftUuid)).toBeUndefined();
    });

    it('should reject deleting a non-draft email with HTTP 409 Conflict', async () => {
      const res = await request(app).delete(`/api/emails/${scheduledUuid}`);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain("Only emails in 'DRAFT' status can be deleted");
      expect(emailsStore.find((e) => e.id === scheduledUuid)).toBeDefined();
    });
  });

  describe('Transactional Outbox Pattern', () => {
    it('should atomically create both email and outbox event in same transaction', async () => {
      const scheduledTime = new Date(Date.now() + 1000000);
      const result = await createScheduledEmailWithOutbox({
        recipient: 'outbox@example.com',
        subject: 'Transactional Outbox Test',
        body: 'Transactional payload',
        scheduledTime,
      });

      expect(result.email).toBeDefined();
      expect(result.outboxEvent).toBeDefined();
      expect(result.email.status).toBe('SCHEDULED');
      expect(result.outboxEvent.eventType).toBe('EMAIL_SCHEDULED');
      expect(result.outboxEvent.aggregateId).toBe(result.email.id);
      expect(emailsStore.length).toBe(1);
      expect(outboxStore.length).toBe(1);
    });

    it('should rollback email creation if outbox event insertion fails', async () => {
      // Force outboxEvent.create to throw an error inside transaction
      vi.spyOn(mockPrisma.outboxEvent, 'create').mockRejectedValueOnce(
        new Error('Outbox write failure')
      );

      await expect(
        createScheduledEmailWithOutbox({
          recipient: 'fail@example.com',
          subject: 'Rollback Test',
          body: 'This should rollback',
          scheduledTime: new Date(),
        })
      ).rejects.toThrow('Outbox write failure');

      // Verify transaction rollback: no email or outbox was persisted
      expect(emailsStore.length).toBe(0);
      expect(outboxStore.length).toBe(0);
    });
  });
});
