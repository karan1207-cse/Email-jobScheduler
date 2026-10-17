/**
 * Elasticsearch Search Tests — Milestone 9
 *
 * Tests the search routes with mocked Elasticsearch and Postgres fallback.
 * All tests verify:
 * - Multi-user isolation (userId scoping)
 * - Proper fallback when ES is unavailable
 * - Input validation and error handling
 * - Admin endpoint protection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Hoist mocks BEFORE any imports that pull in the mocked modules
// vi.hoisted() runs before module graph resolution
// ---------------------------------------------------------------------------

const {
  mockSearchEmails,
  mockRebuildEmailIndex,
  mockIsElasticsearchAvailable,
} = vi.hoisted(() => ({
  mockSearchEmails:             vi.fn(),
  mockRebuildEmailIndex:        vi.fn(),
  mockIsElasticsearchAvailable: vi.fn(),
}));

vi.mock('../services/elasticsearch.service.js', () => ({
  searchEmails:             mockSearchEmails,
  rebuildEmailIndex:        mockRebuildEmailIndex,
  isElasticsearchAvailable: mockIsElasticsearchAvailable,
  indexEmail:               vi.fn().mockResolvedValue(undefined),
  deleteEmailFromIndex:     vi.fn().mockResolvedValue(undefined),
  ensureIndexExists:        vi.fn().mockResolvedValue(undefined),
  EMAIL_INDEX:              'reachinbox_emails',
}));

// ---------------------------------------------------------------------------
// Mock auth middleware to inject userId into session
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'test-user-uuid-search-9999';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.session = req.session || {};
    req.session.userId = TEST_USER_ID;
    next();
  },
}));

// Mock Bull Board so it doesn't try to connect to Redis
vi.mock('../queue/dashboard.js', () => ({
  createQueueDashboard: () => null,
  DASHBOARD_BASE_PATH:  '/admin/queues',
}));

// Mock Prisma (only used for any residual DB calls within email.service hooks)
vi.mock('../db/prisma.js', () => ({
  getPrismaClient: () => ({
    user:  { upsert: vi.fn().mockResolvedValue({}) },
    email: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst:  vi.fn().mockResolvedValue(null),
      findMany:   vi.fn().mockResolvedValue([]),
      count:      vi.fn().mockResolvedValue(0),
      create:     vi.fn().mockResolvedValue({}),
      update:     vi.fn().mockResolvedValue({}),
      delete:     vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  }),
}));

// ---------------------------------------------------------------------------
// Import app AFTER mocks are declared
// ---------------------------------------------------------------------------

import { createApp } from '../app.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/search/status', () => {
  beforeEach(() => {
    mockIsElasticsearchAvailable.mockReset();
  });

  it('reports elasticsearch available=true', async () => {
    mockIsElasticsearchAvailable.mockResolvedValueOnce(true);
    const app = createApp();
    const res = await request(app).get('/api/search/status');
    expect(res.status).toBe(200);
    expect(res.body.elasticsearch.available).toBe(true);
    expect(res.body.elasticsearch.index).toBe('reachinbox_emails');
  });

  it('reports elasticsearch available=false when ES is down', async () => {
    mockIsElasticsearchAvailable.mockResolvedValueOnce(false);
    const app = createApp();
    const res = await request(app).get('/api/search/status');
    expect(res.status).toBe(200);
    expect(res.body.elasticsearch.available).toBe(false);
  });
});

describe('GET /api/search/emails', () => {
  beforeEach(() => {
    mockSearchEmails.mockReset();
  });

  const mockResult = {
    data:       [],
    total:      0,
    page:       1,
    limit:      20,
    totalPages: 1,
    source:     'elasticsearch' as const,
  };

  it('returns search results for authenticated user', async () => {
    mockSearchEmails.mockResolvedValueOnce({ ...mockResult, data: [] });
    const app = createApp();
    const res = await request(app).get('/api/search/emails');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('source');
  });

  it('passes userId from session to searchEmails (multi-user isolation)', async () => {
    mockSearchEmails.mockResolvedValueOnce(mockResult);
    const app = createApp();
    await request(app).get('/api/search/emails?q=hello');
    expect(mockSearchEmails).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TEST_USER_ID, query: 'hello' })
    );
  });

  it('passes status filter correctly', async () => {
    mockSearchEmails.mockResolvedValueOnce(mockResult);
    const app = createApp();
    await request(app).get('/api/search/emails?status=SENT');
    expect(mockSearchEmails).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SENT' })
    );
  });

  it('rejects invalid status enum', async () => {
    const app = createApp();
    const res = await request(app).get('/api/search/emails?status=INVALID_STATUS');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('handles pagination parameters', async () => {
    mockSearchEmails.mockResolvedValueOnce({ ...mockResult, page: 2, limit: 10 });
    const app = createApp();
    await request(app).get('/api/search/emails?page=2&limit=10');
    expect(mockSearchEmails).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 10 })
    );
  });

  it('rejects limit > 100', async () => {
    const app = createApp();
    const res = await request(app).get('/api/search/emails?limit=999');
    expect(res.status).toBe(400);
  });

  it('passes date range filters', async () => {
    mockSearchEmails.mockResolvedValueOnce(mockResult);
    const app = createApp();
    const from = '2024-01-01T00:00:00Z';
    const to   = '2024-12-31T23:59:59Z';
    await request(app).get(`/api/search/emails?fromDate=${from}&toDate=${to}`);
    expect(mockSearchEmails).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: from, toDate: to })
    );
  });

  it('falls back when source is postgres_fallback', async () => {
    mockSearchEmails.mockResolvedValueOnce({ ...mockResult, source: 'postgres_fallback' });
    const app = createApp();
    const res = await request(app).get('/api/search/emails');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('postgres_fallback');
  });
});

describe('POST /api/search/rebuild', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockRebuildEmailIndex.mockReset();
    mockIsElasticsearchAvailable.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows rebuild from localhost when no ADMIN_TOKEN set', async () => {
    mockIsElasticsearchAvailable.mockResolvedValueOnce(true);
    mockRebuildEmailIndex.mockResolvedValueOnce({ indexed: 42, errors: 0 });
    delete process.env['ADMIN_TOKEN'];
    const app = createApp();
    // supertest sends requests from 127.0.0.1 / ::ffff:127.0.0.1
    const res = await request(app).post('/api/search/rebuild');
    expect(res.status).toBe(200);
    expect(res.body.indexed).toBe(42);
    expect(res.body.errors).toBe(0);
  });

  it('returns 503 when Elasticsearch is unavailable', async () => {
    mockIsElasticsearchAvailable.mockResolvedValueOnce(false);
    delete process.env['ADMIN_TOKEN'];
    const app = createApp();
    const res = await request(app).post('/api/search/rebuild');
    expect(res.status).toBe(503);
  });

  it('allows rebuild with correct ADMIN_TOKEN header', async () => {
    process.env['ADMIN_TOKEN'] = 'super-secret-admin-token';
    mockIsElasticsearchAvailable.mockResolvedValueOnce(true);
    mockRebuildEmailIndex.mockResolvedValueOnce({ indexed: 10, errors: 0 });
    const app = createApp();
    const res = await request(app)
      .post('/api/search/rebuild')
      .set('x-admin-token', 'super-secret-admin-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects rebuild with wrong ADMIN_TOKEN', async () => {
    process.env['ADMIN_TOKEN'] = 'super-secret-admin-token';
    const app = createApp();
    const res = await request(app)
      .post('/api/search/rebuild')
      .set('x-admin-token', 'wrong-token');
    expect(res.status).toBe(403);
  });
});
