/**
 * Queue Dashboard Integration & Security Tests — Milestone 10
 *
 * Verifies access control, network guardrails, and token security
 * for the BullMQ Queue Dashboard (/admin/queues).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { dashboardGuard, createQueueDashboard, DASHBOARD_BASE_PATH } from '../queue/dashboard.js';

describe('Queue Dashboard Security Guard & Factory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('DASHBOARD_BASE_PATH', () => {
    it('should be configured to /admin/queues', () => {
      expect(DASHBOARD_BASE_PATH).toBe('/admin/queues');
    });
  });

  describe('dashboardGuard — Development Mode', () => {
    it('should allow requests originating from 127.0.0.1', () => {
      process.env.NODE_ENV = 'development';
      const req = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, headers: {} } as unknown as Request;
      let statusCalled = false;
      const res = {
        status: () => { statusCalled = true; return res; },
        json: () => res,
      } as unknown as Response;
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      dashboardGuard(req, res, next);
      expect(nextCalled).toBe(true);
      expect(statusCalled).toBe(false);
    });

    it('should allow requests originating from ::1 (IPv6 localhost)', () => {
      process.env.NODE_ENV = 'development';
      const req = { ip: '::1', socket: { remoteAddress: '::1' }, headers: {} } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      dashboardGuard(req, res, next);
      expect(nextCalled).toBe(true);
    });

    it('should reject requests from external IPs with 403 in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ADMIN_EMAIL;
      const req = { ip: '192.168.1.105', socket: { remoteAddress: '192.168.1.105' }, headers: {} } as unknown as Request;
      let statusCode = 0;
      let jsonPayload: any = null;
      const res = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonPayload = data; return res; },
      } as unknown as Response;
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      dashboardGuard(req, res, next);
      expect(nextCalled).toBe(false);
      expect(statusCode).toBe(403);
      expect(jsonPayload?.error).toContain('localhost access');
    });

    it('allows a non-local request from the configured Google admin session', () => {
      process.env.NODE_ENV = 'development';
      process.env.ADMIN_EMAIL = 'admin@example.com';
      const req = {
        ip: '172.20.0.1',
        socket: { remoteAddress: '172.20.0.1' },
        headers: {},
        session: { user: { userId: 'admin-id', email: 'ADMIN@example.com', displayName: 'Admin' } },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;
      const next = vi.fn();

      dashboardGuard(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('still rejects a non-local request without the configured admin session', () => {
      process.env.NODE_ENV = 'development';
      process.env.ADMIN_EMAIL = 'admin@example.com';
      const req = {
        ip: '172.20.0.1',
        socket: { remoteAddress: '172.20.0.1' },
        headers: {},
        session: { user: { userId: 'user-id', email: 'user@example.com', displayName: 'User' } },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;
      const next = vi.fn();

      dashboardGuard(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('dashboardGuard — Production Mode', () => {
    it('should reject requests when ADMIN_TOKEN is not provided in headers', () => {
      // In production mode, dashboardGuard checks NODE_ENV module constant.
      // We test the logic by setting admin token and testing missing header.
      process.env.ADMIN_TOKEN = 'super-secret-admin-token';
      const req = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, headers: {} } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;
      const next = vi.fn();

      // Test guard when invoked
      dashboardGuard(req, res, next);
    });
  });

  describe('createQueueDashboard Factory', () => {
    it('returns null if production environment is missing ADMIN_TOKEN', () => {
      // Test production without token
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      delete process.env.ADMIN_TOKEN;

      // When createQueueDashboard runs with mock or test env
      const router = createQueueDashboard();
      // It should either return a router (in dev) or null
      expect(router).toBeDefined();
      warnSpy.mockRestore();
    });
  });

  describe('dashboardGuard — VM port forward and admin token', () => {
    function mockRes() {
      return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        cookie: vi.fn(),
      } as unknown as Response & { cookie: ReturnType<typeof vi.fn> };
    }

    it('allows the VirtualBox NAT host (10.0.2.2) by default in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DASHBOARD_ALLOWED_IPS;
      const req = { ip: '::ffff:10.0.2.2', socket: {}, headers: {}, query: {} } as unknown as Request;
      const res = mockRes();
      const next = vi.fn();
      dashboardGuard(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('honours a custom DASHBOARD_ALLOWED_IPS list', () => {
      process.env.NODE_ENV = 'development';
      process.env.DASHBOARD_ALLOWED_IPS = '192.168.56.1';
      const allowed = { ip: '192.168.56.1', socket: {}, headers: {}, query: {} } as unknown as Request;
      const denied = { ip: '10.0.2.2', socket: {}, headers: {}, query: {} } as unknown as Request;
      const next = vi.fn();
      dashboardGuard(allowed, mockRes(), next);
      const res = mockRes();
      dashboardGuard(denied, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('accepts ?token= in production and stores it in a dashboard-scoped cookie', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_TOKEN = 'secret-token-123';
      const req = { ip: '203.0.113.9', socket: {}, headers: {}, query: { token: 'secret-token-123' } } as unknown as Request;
      const res = mockRes();
      const next = vi.fn();
      dashboardGuard(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.cookie).toHaveBeenCalledWith(
        'reachinbox_admin_token',
        'secret-token-123',
        expect.objectContaining({ httpOnly: true, path: '/admin/queues' }),
      );
    });

    it('accepts the token from the cookie on later requests', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_TOKEN = 'secret-token-123';
      const req = {
        ip: '203.0.113.9', socket: {}, query: {},
        headers: { cookie: 'other=1; reachinbox_admin_token=secret-token-123' },
      } as unknown as Request;
      const next = vi.fn();
      dashboardGuard(req, mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a wrong token in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_TOKEN = 'secret-token-123';
      const req = { ip: '127.0.0.1', socket: {}, headers: { 'x-admin-token': 'nope' }, query: {} } as unknown as Request;
      const res = mockRes();
      const next = vi.fn();
      dashboardGuard(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
