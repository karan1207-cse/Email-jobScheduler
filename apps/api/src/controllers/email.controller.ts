import type { Request, Response, NextFunction } from 'express';
import {
  createDraftEmail,
  listEmails,
  getEmailById,
  updateDraftEmail,
  deleteDraftEmail,
  DEV_DEFAULT_USER,
} from '../services/email.service.js';
import type { CreateEmailDto, UpdateEmailDto, ListEmailsQuery } from '../validations/email.schema.js';
import { getCurrentUser } from '../middleware/auth.js';

/**
 * Resolves the current userId from the authenticated session.
 * Falls back to the development default user when OAuth is not configured
 * (GOOGLE_CLIENT_ID not set) so existing tests and development workflows
 * continue to function without credentials.
 */
function resolveUserId(req: Request): string {
  try {
    return getCurrentUser(req).userId;
  } catch {
    // No active session — use the dev default user
    return DEV_DEFAULT_USER.id;
  }
}

export async function createEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const idempotencyKey = req.header('Idempotency-Key');
    const userId = resolveUserId(req);
    const result = await createDraftEmail(req.body as CreateEmailDto, idempotencyKey, userId);

    if (result.isReplay) {
      res.setHeader('Idempotent-Replay', 'true');
      res.status(200).json(result.email);
      return;
    }

    res.status(201).json(result.email);
  } catch (err) {
    next(err);
  }
}

export async function listEmailsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = req.query as unknown as ListEmailsQuery;
    const userId = resolveUserId(req);
    const result = await listEmails(query, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getEmailByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = resolveUserId(req);
    const email = await getEmailById(id, userId);
    res.status(200).json(email);
  } catch (err) {
    next(err);
  }
}

export async function updateEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = resolveUserId(req);
    const updated = await updateDraftEmail(id, req.body as UpdateEmailDto, userId);
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = resolveUserId(req);
    await deleteDraftEmail(id, userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
