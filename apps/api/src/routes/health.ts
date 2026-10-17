import { Router, type Request, type Response } from 'express';
import type { HealthCheckResponse, SystemStatus } from '@reachinbox/shared';
import { checkDatabaseHealth } from '../db/client.js';
import { checkRedisHealth } from '../redis/client.js';
import {
  getEmbeddedWorkerStatus,
  isEmbeddedWorkerEnabled,
  type EmbeddedWorkerStatus,
} from '../embedded-worker.js';

export const healthRouter = Router();

const readinessHandler = async (_req: Request, res: Response<HealthCheckResponse>) => {
  const [databaseHealth, redisHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);

  const isHealthy = databaseHealth.status === 'up' && redisHealth.status === 'up';
  const overallStatus: SystemStatus = isHealthy ? 'healthy' : 'unhealthy';
  const statusCode = isHealthy ? 200 : 503;

  const response: HealthCheckResponse & { worker?: EmbeddedWorkerStatus } = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    services: {
      database: databaseHealth,
      redis: redisHealth,
    },
  };
  if (isEmbeddedWorkerEnabled()) {
    response.worker = getEmbeddedWorkerStatus();
  }

  res.status(statusCode).json(response);
};

healthRouter.get('/health', readinessHandler);
healthRouter.get('/ready', readinessHandler);
