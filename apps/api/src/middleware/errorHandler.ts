import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export interface AppError extends Error {
  statusCode?: number;
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: `Cannot ${req.method} ${req.path}`,
      status: 404,
    },
  });
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const statusCode = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  
  // Safe sanitized message for public client consumption
  const safeMessage = statusCode === 500 && config.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message || 'An unexpected error occurred';

  // Do not expose stack traces or internal secrets to client
  res.status(statusCode).json({
    error: {
      message: safeMessage,
      status: statusCode,
    },
  });
}
