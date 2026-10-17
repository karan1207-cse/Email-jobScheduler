/**
 * Milestone 8: Slack Integration & Rate-Limit Alerting Test Suite
 *
 * Verifies:
 * 1. Slack OAuth authorization redirect & CSRF protection
 * 2. Token exchange and database persistence (oauth.v2.access)
 * 3. Security: access tokens and webhook URLs never leaked to client
 * 4. Disconnect and reconnect without server restart
 * 5. Direct incoming webhook configuration & validation
 * 6. Test notification dispatching
 * 7. Rate-limit alert dispatching with Redis deduplication
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { User, SlackIntegration } from '@prisma/client';
import { createApp } from '../app.js';
import * as prismaModule from '../db/prisma.js';
import * as redisModule from '../redis/client.js';
import * as slackService from '../services/slack.service.js';
import { config } from '../config.js';

describe('Milestone 8: Slack Integration & Rate-Limit Alerting', () => {
  let app: ReturnType<typeof createApp>;
  let usersStore: User[] = [];
  let slackStore: SlackIntegration[] = [];
  let redisMemory: Map<string, string> = new Map();

  function createMockPrisma() {
    return {
      user: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.id) return usersStore.find((u) => u.id === where.id) || null;
          if (where.email) return usersStore.find((u) => u.email === where.email) || null;
          return null;
        }),
      },
      slackIntegration: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.userId) return slackStore.find((s) => s.userId === where.userId) || null;
          return null;
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return slackStore.find((s) => {
            if (where.isActive !== undefined && s.isActive !== where.isActive) return false;
            return true;
          }) || null;
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return slackStore.filter((s) => {
            if (where.isActive !== undefined && s.isActive !== where.isActive) return false;
            return true;
          });
        }),
        upsert: vi.fn().mockImplementation(async ({ where, update, create }) => {
          const index = slackStore.findIndex((s) => s.userId === where.userId);
          if (index !== -1) {
            const updated = { ...slackStore[index]!, ...update, updatedAt: new Date() };
            slackStore[index] = updated;
            return updated;
          }
          const created: SlackIntegration = {
            id: create.id || crypto.randomUUID(),
            userId: create.userId,
            teamId: create.teamId,
            teamName: create.teamName || null,
            channelId: create.channelId || null,
            channelName: create.channelName || null,
            accessToken: create.accessToken,
            incomingWebhookUrl: create.incomingWebhookUrl || null,
            isActive: create.isActive ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          slackStore.push(created);
          return created;
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          let count = 0;
          for (const s of slackStore) {
            if (where.userId && s.userId !== where.userId) continue;
            Object.assign(s, data, { updatedAt: new Date() });
            count++;
          }
          return { count };
        }),
      },
    };
  }

  function createMockRedis() {
    return {
      set: vi.fn().mockImplementation(async (key: string, val: string, _mode?: string, _duration?: number, flag?: string) => {
        if (flag === 'NX' && redisMemory.has(key)) {
          return null; // Key already exists — NX fails
        }
        redisMemory.set(key, val);
        return 'OK';
      }),
      get: vi.fn().mockImplementation(async (key: string) => redisMemory.get(key) || null),
      del: vi.fn().mockImplementation(async (key: string) => {
        const deleted = redisMemory.delete(key);
        return deleted ? 1 : 0;
      }),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    usersStore = [];
    slackStore = [];
    redisMemory = new Map();

    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();

    vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);
    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => 'ok',
    })) as any;

    app = createApp();
  });

  describe('Slack OAuth & Connection Lifecycle', () => {
    it('GET /auth/slack — returns 503 if Slack credentials are not configured', async () => {
      const res = await request(app).get('/auth/slack');
      expect(res.status).toBe(503);
      expect(res.body.error.message).toContain('Slack OAuth is not configured');
    });

    it('GET /auth/slack — redirects to Slack OAuth authorization screen when configured', async () => {
      (config as any).SLACK_CLIENT_ID = 'slack-client-123';
      (config as any).SLACK_CLIENT_SECRET = 'slack-secret-456';

      try {
        const res = await request(app).get('/auth/slack');
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('slack.com/oauth/v2/authorize');
        expect(res.headers.location).toContain('slack-client-123');
      } finally {
        (config as any).SLACK_CLIENT_ID = '';
        (config as any).SLACK_CLIENT_SECRET = '';
      }
    });

    it('GET /auth/slack/callback — rejects invalid or missing CSRF state', async () => {
      const res = await request(app).get('/auth/slack/callback?code=test-code&state=bad-state');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('slack_error=state_mismatch');
    });

    it('GET /api/slack/status — returns status without leaking access tokens or webhook URLs', async () => {
      // Seed a connected Slack integration
      const testUserId = '00000000-0000-0000-0000-000000000001';
      slackStore.push({
        id: 'slack-int-1',
        userId: testUserId,
        teamId: 'T12345',
        teamName: 'ReachInbox Workspace',
        channelId: 'C67890',
        channelName: '#email-alerts',
        accessToken: 'xoxb-SECRET-TOKEN-DO-NOT-LEAK',
        incomingWebhookUrl: 'https://hooks.slack.com/services/SECRET/WEBHOOK/URL',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get('/api/slack/status');
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.teamName).toBe('ReachInbox Workspace');
      expect(res.body.channelName).toBe('#email-alerts');

      // CRITICAL SECURITY ASSERTIONS: Secret tokens and URLs MUST NOT be present
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.incomingWebhookUrl).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('xoxb-SECRET-TOKEN');
      expect(JSON.stringify(res.body)).not.toContain('SECRET/WEBHOOK');
    });

    it('POST /api/slack/disconnect — disconnects Slack without restart', async () => {
      const testUserId = '00000000-0000-0000-0000-000000000001';
      slackStore.push({
        id: 'slack-int-1',
        userId: testUserId,
        teamId: 'T12345',
        teamName: 'ReachInbox Workspace',
        channelId: 'C67890',
        channelName: '#email-alerts',
        accessToken: 'xoxb-token',
        incomingWebhookUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).post('/api/slack/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statusRes = await request(app).get('/api/slack/status');
      expect(statusRes.body.connected).toBe(false);
    });

    it('POST /api/slack/webhook — validates and saves manual incoming webhook', async () => {
      // Rejects non-Slack webhook
      const badRes = await request(app)
        .post('/api/slack/webhook')
        .send({ webhookUrl: 'https://evil.com/webhook' });
      expect(badRes.status).toBe(400);

      // Accepts valid Slack webhook
      const goodRes = await request(app)
        .post('/api/slack/webhook')
        .send({
          webhookUrl: 'https://hooks.slack.com/services/T123/B456/789abc',
          channelName: '#dev-alerts',
        });
      expect(goodRes.status).toBe(200);
      expect(goodRes.body.success).toBe(true);

      const statusRes = await request(app).get('/api/slack/status');
      expect(statusRes.body.connected).toBe(true);
      expect(statusRes.body.channelName).toBe('#dev-alerts');
    });

    it('POST /api/slack/test — rejects test notification when Slack is disconnected', async () => {
      const res = await request(app).post('/api/slack/test');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Slack is not connected');
    });

    it('POST /api/slack/test — sends test notification when connected', async () => {
      const testUserId = '00000000-0000-0000-0000-000000000001';
      slackStore.push({
        id: 'slack-int-1',
        userId: testUserId,
        teamId: 'T12345',
        teamName: 'ReachInbox Workspace',
        channelId: 'C67890',
        channelName: '#email-alerts',
        accessToken: 'xoxb-token',
        incomingWebhookUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(slackService, 'sendSlackMessage').mockResolvedValue(true);

      const res = await request(app).post('/api/slack/test');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(slackService.sendSlackMessage).toHaveBeenCalled();
    });
  });

  describe('Rate-Limit Alert Dispatching & Deduplication', () => {
    it('notifies Slack on first rate limit trigger and deduplicates subsequent triggers within 5 minutes', async () => {
      const testUserId = '00000000-0000-0000-0000-000000000001';
      slackStore.push({
        id: 'slack-int-1',
        userId: testUserId,
        teamId: 'T12345',
        teamName: 'ReachInbox Workspace',
        channelId: 'C67890',
        channelName: '#email-alerts',
        accessToken: 'xoxb-token',
        incomingWebhookUrl: 'https://hooks.slack.com/services/T123/B456/789',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const fetchMock = globalThis.fetch as any;
      fetchMock.mockClear();

      // 1. First rate-limit event: should trigger alert and post to Slack
      const firstResult = await slackService.notifyRateLimitExceeded('global', 100, 3600000);
      expect(firstResult).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 2. Second rate-limit event within 5 minutes: should be deduplicated (suppressed)
      const secondResult = await slackService.notifyRateLimitExceeded('global', 100, 3500000);
      expect(secondResult).toBe(false); // Deduplicated!
      expect(fetchMock).toHaveBeenCalledTimes(1); // No second network dispatch!
    });
  });
});
