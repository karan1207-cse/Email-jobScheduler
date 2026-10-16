import type { Request, Response, NextFunction } from 'express';
import {
  createDraftEmail,
  listEmails,
  getEmailById,
  updateDraftEmail,
  deleteDraftEmail,
} from '../services/email.service.js';
import type { CreateEmailDto, UpdateEmailDto, ListEmailsQuery } from '../validations/email.schema.js';

export async function createEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const idempotencyKey = req.header('Idempotency-Key');
    const result = await createDraftEmail(req.body as CreateEmailDto, idempotencyKey);

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
    const result = await listEmails(query);
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
    const email = await getEmailById(id);
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
    const updated = await updateDraftEmail(id, req.body as UpdateEmailDto);
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
    await deleteDraftEmail(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
