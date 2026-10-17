/**
 * Search Routes — Milestone 9
 *
 * GET  /api/search/emails    — Full-text email search (Elasticsearch or Postgres fallback)
 * POST /api/search/rebuild   — Admin-only: rebuild the entire Elasticsearch index from Postgres
 * GET  /api/search/status    — Elasticsearch availability probe
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  searchEmails,
  rebuildEmailIndex,
  isElasticsearchAvailable,
  EMAIL_INDEX,
} from '../services/elasticsearch.service.js';

export const searchRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const searchQuerySchema = z.object({
  q:        z.string().trim().max(500).optional(),
  status:   z.enum(['DRAFT', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED']).optional(),
  fromDate: z.string().datetime({ offset: true }).optional(),
  toDate:   z.string().datetime({ offset: true }).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// GET /api/search/status
// ---------------------------------------------------------------------------

searchRouter.get('/api/search/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const available = await isElasticsearchAvailable();
    res.json({
      elasticsearch: {
        available,
        index:  EMAIL_INDEX,
        url:    process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/search/emails — requires authentication
// ---------------------------------------------------------------------------

searchRouter.get(
  '/api/search/emails',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error:   'Validation error',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const { q, status, fromDate, toDate, page, limit } = parsed.data;

      // userId is guaranteed by requireAuth middleware
      const userId = (req.session as { userId?: string }).userId!;

      const result = await searchEmails({
        userId,
        query:    q,
        status,
        fromDate,
        toDate,
        page,
        limit,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/search/rebuild — admin / local-dev only
// ---------------------------------------------------------------------------

/**
 * This endpoint is protected by a simple ADMIN_TOKEN environment variable.
 * In production, set ADMIN_TOKEN to a long random secret and only call this
 * from internal tooling. In development (no token set), access is restricted
 * to localhost requests only.
 */
searchRouter.post(
  '/api/search/rebuild',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminToken = process.env.ADMIN_TOKEN;

      if (adminToken) {
        // Token-protected mode (production or staging)
        const provided = (req.headers['x-admin-token'] as string | undefined) || '';
        if (provided !== adminToken) {
          res.status(403).json({ error: 'Forbidden: invalid admin token.' });
          return;
        }
      } else {
        // No token configured — only allow loopback requests
        const ip = req.ip || req.socket.remoteAddress || '';
        const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        if (!isLocal) {
          res.status(403).json({
            error: 'Forbidden: set ADMIN_TOKEN env var to call this endpoint remotely.',
          });
          return;
        }
      }

      const available = await isElasticsearchAvailable();
      if (!available) {
        res.status(503).json({ error: 'Elasticsearch is not available.' });
        return;
      }

      const { indexed, errors } = await rebuildEmailIndex();
      res.json({ success: true, indexed, errors });
    } catch (err) {
      next(err);
    }
  }
);
