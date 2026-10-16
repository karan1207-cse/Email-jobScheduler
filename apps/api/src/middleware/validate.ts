import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodSchema } from 'zod';

function formatZodIssues(err: ZodError) {
  const issues = err.issues || (err as unknown as { errors?: Array<{ path: (string | number)[]; message: string }> }).errors || [];
  return issues.map((e) => ({
    field: e.path.join('.'),
    message: e.message,
  }));
}

export function validateBody(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: {
            message: 'Validation failed',
            status: 400,
            details: formatZodIssues(err),
          },
        });
        return;
      }
      next(err);
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.query);
      req.query = parsed as Record<string, unknown> as typeof req.query;
      next();
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: {
            message: 'Invalid query parameters',
            status: 400,
            details: formatZodIssues(err),
          },
        });
        return;
      }
      next(err);
    }
  };
}

export function validateParams(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.params);
      req.params = parsed as Record<string, string>;
      next();
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: {
            message: 'Invalid route parameters',
            status: 400,
            details: formatZodIssues(err),
          },
        });
        return;
      }
      next(err);
    }
  };
}
