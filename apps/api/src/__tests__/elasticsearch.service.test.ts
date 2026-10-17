import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockFindMany, mockCount } = vi.hoisted(() => ({
  mockClient: {
    ping: vi.fn(),
    indices: { exists: vi.fn(), create: vi.fn() },
    search: vi.fn(),
  },
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn(() => mockClient),
}));

vi.mock('../db/prisma.js', () => ({
  getPrismaClient: () => ({ email: { findMany: mockFindMany, count: mockCount } }),
}));

import { searchEmails } from '../services/elasticsearch.service.js';

describe('searchEmails with a stale Elasticsearch index', () => {
  beforeEach(() => {
    mockClient.ping.mockReset().mockResolvedValue(true);
    mockClient.indices.exists.mockReset().mockResolvedValue(true);
    mockClient.search.mockReset().mockResolvedValue({
      hits: { hits: [], total: { value: 0 } },
    });
    mockFindMany.mockReset().mockResolvedValue([{
      id: 'email-1',
      userId: 'user-1',
      recipient: 'person@example.invalid',
      subject: 'demo subject',
      body: 'test body',
      status: 'SCHEDULED',
      scheduledTime: new Date('2026-10-17T13:00:00.000Z'),
      sentAt: null,
      createdAt: new Date('2026-10-17T12:00:00.000Z'),
      updatedAt: new Date('2026-10-17T12:00:00.000Z'),
      attemptCount: 0,
      lastError: null,
    }]);
    mockCount.mockReset().mockResolvedValue(1);
  });

  it('falls back to PostgreSQL for a query missing from a reachable index', async () => {
    const result = await searchEmails({
      userId: 'user-1',
      query: 'demo',
      status: 'SCHEDULED',
      page: 1,
      limit: 20,
    });

    expect(result.source).toBe('postgres_fallback');
    expect(result.total).toBe(1);
    expect(result.data[0]?.subject).toBe('demo subject');
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        status: 'SCHEDULED',
        OR: expect.arrayContaining([
          expect.objectContaining({ subject: expect.objectContaining({ contains: 'demo' }) }),
        ]),
      }),
    }));
  });
});
