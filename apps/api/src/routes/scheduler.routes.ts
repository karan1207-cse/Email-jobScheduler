import { Router } from 'express';
import { scheduleEmailHandler, cancelEmailHandler } from '../controllers/scheduler.controller.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { scheduleEmailSchema } from '../validations/scheduler.schema.js';
import { idParamSchema } from '../validations/email.schema.js';
import { requireAuth } from '../middleware/auth.js';

export const schedulerRouter = Router();

// Protect all scheduler endpoints with authentication
schedulerRouter.use('/api/emails', requireAuth);

// POST /api/emails/:id/schedule — Schedule a DRAFT email for future delivery
schedulerRouter.post(
  '/api/emails/:id/schedule',
  validateParams(idParamSchema),
  validateBody(scheduleEmailSchema),
  scheduleEmailHandler
);

// POST /api/emails/:id/cancel — Cancel a SCHEDULED email
schedulerRouter.post(
  '/api/emails/:id/cancel',
  validateParams(idParamSchema),
  cancelEmailHandler
);
