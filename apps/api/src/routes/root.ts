import { Router, type Request, type Response } from 'express';
import type { ApiRootResponse } from '@reachinbox/shared';

export const rootRouter = Router();

rootRouter.get('/', (_req: Request, res: Response<ApiRootResponse>) => {
  const response: ApiRootResponse = {
    name: 'ReachInbox Email Job Scheduler API',
    version: '1.0.0',
    status: 'online',
    description: 'Production-ready delayed email scheduling platform API',
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(response);
});
