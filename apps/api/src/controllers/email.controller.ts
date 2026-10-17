import type { Request, Response, NextFunction } from 'express';
import {
  createDraftEmail,
  listEmails,
  getEmailById,
  updateDraftEmail,
  deleteDraftEmail,
} from '../services/email.service.js';
import type { CreateEmailDto, UpdateEmailDto, ListEmailsQuery } from '../validations/email.schema.js';
import { getCurrentUser } from '../middleware/auth.js';

function resolveUserId(req: Request): string {
  return getCurrentUser(req).userId;
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
