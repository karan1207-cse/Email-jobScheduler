import type { Request, Response, NextFunction } from 'express';
import { scheduleEmail, cancelScheduledEmail } from '../services/scheduler.service.js';
import type { ScheduleEmailInput } from '../validations/scheduler.schema.js';
import { getCurrentUser } from '../middleware/auth.js';

function resolveUserId(req: Request): string {
  return getCurrentUser(req).userId;
}

export async function scheduleEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = resolveUserId(req);
    const result = await scheduleEmail(id, req.body as ScheduleEmailInput, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function cancelEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = resolveUserId(req);
    const result = await cancelScheduledEmail(id, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
