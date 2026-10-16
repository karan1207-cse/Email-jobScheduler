import type { Request, Response, NextFunction } from 'express';
import { scheduleEmail, cancelScheduledEmail } from '../services/scheduler.service.js';
import type { ScheduleEmailInput } from '../validations/scheduler.schema.js';

export async function scheduleEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const result = await scheduleEmail(id, req.body as ScheduleEmailInput);
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
    const result = await cancelScheduledEmail(id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
