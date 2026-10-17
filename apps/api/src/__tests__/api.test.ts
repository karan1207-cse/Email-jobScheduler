import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../queue/dashboard.js', () => ({
  createQueueDashboard: () => null,
  closeQueueDashboard: vi.fn().mockResolvedValue(undefined),
  DASHBOARD_BASE_PATH: '/admin/queues',
  dashboardGuard: vi.fn(),
}));

import { createApp } from '../app.js';
import * as dbModule from '../db/client.js';
import * as redisModule from '../redis/client.js';

describe('ReachInbox API Endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /', () => {
    it('should return 200 and API identification response', async () => {
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name', 'ReachInbox Email Job Scheduler API');
      expect(res.body).toHaveProperty('version', '1.0.0');
      expect(res.body).toHaveProperty('status', 'online');
      expect(res.body).toHaveProperty('description');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('GET /health', () => {
    it('should return 200 and status healthy when both DB and Redis are up', async () => {
      vi.spyOn(dbModule, 'checkDatabaseHealth').mockResolvedValue({
        status: 'up',
        latencyMs: 3,
      });

      vi.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue({
        status: 'up',
        latencyMs: 1,
      });

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.services.database.status).toBe('up');
      expect(res.body.services.redis.status).toBe('up');
      expect(res.body.services.database.latencyMs).toBe(3);
      expect(res.body.services.redis.latencyMs).toBe(1);
    });

    it('should return 503 and status unhealthy when DB is down', async () => {
      vi.spyOn(dbModule, 'checkDatabaseHealth').mockResolvedValue({
        status: 'down',
        message: 'Database service unreachable or query failed.',
      });

      vi.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue({
        status: 'up',
        latencyMs: 2,
      });

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.services.database.status).toBe('down');
      expect(res.body.services.redis.status).toBe('up');
    });

    it('should return 503 and status unhealthy when Redis is down', async () => {
      vi.spyOn(dbModule, 'checkDatabaseHealth').mockResolvedValue({
        status: 'up',
        latencyMs: 4,
      });

      vi.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue({
        status: 'down',
        message: 'Redis service unreachable or ping failed.',
      });

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.services.database.status).toBe('up');
      expect(res.body.services.redis.status).toBe('down');
    });

    it('should return 503 and status unhealthy when both DB and Redis are down', async () => {
      vi.spyOn(dbModule, 'checkDatabaseHealth').mockResolvedValue({
        status: 'down',
        message: 'Database service unreachable or query failed.',
      });

      vi.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue({
        status: 'down',
        message: 'Redis service unreachable or ping failed.',
      });

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.services.database.status).toBe('down');
      expect(res.body.services.redis.status).toBe('down');
    });
  });

  describe('GET /ready', () => {
    it('should expose the same dependency readiness check', async () => {
      vi.spyOn(dbModule, 'checkDatabaseHealth').mockResolvedValue({ status: 'up', latencyMs: 1 });
      vi.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue({ status: 'up', latencyMs: 1 });
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.services.database.status).toBe('up');
      expect(res.body.services.redis.status).toBe('up');
    });
  });

  describe('404 Not Found & Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/unknown-route-path');

      expect(res.status).toBe(404);
      expect(res.body.error).toHaveProperty('status', 404);
      expect(res.body.error).toHaveProperty('message');
    });
  });
});
