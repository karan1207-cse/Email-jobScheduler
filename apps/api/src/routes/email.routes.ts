import { Router } from 'express';
import {
  createEmailHandler,
  listEmailsHandler,
  getEmailByIdHandler,
  updateEmailHandler,
  deleteEmailHandler,
} from '../controllers/email.controller.js';
import {
  validateBody,
  validateQuery,
  validateParams,
} from '../middleware/validate.js';
import {
  createEmailSchema,
  updateEmailSchema,
  listEmailsQuerySchema,
  idParamSchema,
} from '../validations/email.schema.js';
import { requireAuth } from '../middleware/auth.js';

export const emailRouter = Router();

// Protect all email endpoints with authentication
emailRouter.use('/api/emails', requireAuth);

// POST /api/emails - Create draft email
emailRouter.post(
  '/api/emails',
  validateBody(createEmailSchema),
  createEmailHandler
);

// GET /api/emails - List paginated emails with optional status filter
emailRouter.get(
  '/api/emails',
  validateQuery(listEmailsQuerySchema),
  listEmailsHandler
);

// GET /api/emails/:id - Get email by ID
emailRouter.get(
  '/api/emails/:id',
  validateParams(idParamSchema),
  getEmailByIdHandler
);

// PATCH /api/emails/:id - Update draft email
emailRouter.patch(
  '/api/emails/:id',
  validateParams(idParamSchema),
  validateBody(updateEmailSchema),
  updateEmailHandler
);

// DELETE /api/emails/:id - Delete draft email
emailRouter.delete(
  '/api/emails/:id',
  validateParams(idParamSchema),
  deleteEmailHandler
);
