/**
 * Unit tests for the worker's Slack rate-limit alert.
 * Slack connections are read from the DB on every hit, so connecting or
 * disconnecting takes effect without a restart.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { Redis } from 'ioredis';

vi.mock('../prisma.js', () => ({ getPrisma: vi.fn() }));

import { getPrisma } from '../prisma.js';
import { dispatchRateLimitAlert } from '../slack-alert.js';

function memoryRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
}

const webhook = { id: 'i1', userId: 'u1', isActive: true, incomingWebhookUrl: 'https://hooks.slack.com/services/T/B/X', accessToken: 'xoxb', channelId: 'C1' };

describe('dispatchRateLimitAlert', () => {
  let integrations: unknown[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let redis: ReturnType<typeof memoryRedis>;

  beforeEach(() => {
    integrations = [];
    redis = memoryRedis();
    (getPrisma as MockedFunction<typeof getPrisma>).mockReturnValue({
      slackIntegration: { findMany: vi.fn(async () => integrations) },
    } as never);
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const hit = () => dispatchRateLimitAlert(redis as unknown as Redis, {
    userId: 'u1', scope: 'u1', hourlyLimit: 2, retryAfterMs: 60_000,
  });

  it('is a silent no-op when the user has not connected Slack', async () => {
    await expect(hit()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // No dedup key was taken, so a later connection still gets this window's alert.
    expect(redis.store.size).toBe(0);
  });

  it('starts notifying as soon as Slack is connected, without a restart', async () => {
    await hit();
    integrations = [webhook];
    await expect(hit()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(webhook.incomingWebhookUrl);
  });

  it('sends one alert per sender per hour window', async () => {
    integrations = [webhook];
    await hit();
    await hit();
    await hit();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('allows a retry in the same window when Slack rejected the alert', async () => {
    integrations = [webhook];
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(hit()).resolves.toBe(false);
    await expect(hit()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses chat.postMessage with the bot token when there is no webhook', async () => {
    integrations = [{ ...webhook, incomingWebhookUrl: null }];
    await expect(hit()).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0]! as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(init.headers.Authorization).toBe('Bearer xoxb');
    expect(JSON.parse(init.body).channel).toBe('C1');
  });

  it('never throws when Slack is unreachable', async () => {
    integrations = [webhook];
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND hooks.slack.com'));
    await expect(hit()).resolves.toBe(false);
  });
});
