import { Redis } from 'ioredis';
import type { DependencyHealth } from '@reachinbox/shared';
import { config } from '../config.js';

let redisInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(config.REDIS_URL, {
      connectTimeout: 3000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Do not hang retrying on offline health checks
      lazyConnect: true,
    });

    redisInstance.on('error', (err: Error) => {
      console.error('[Redis Client Error]', err.message);
    });
  }

  return redisInstance;
}

export async function checkRedisHealth(): Promise<DependencyHealth> {
  const redis = getRedisClient();
  const startTime = performance.now();

  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting' && redis.status !== 'connect') {
      await redis.connect().catch((err: Error) => {
        // Suppress unhandled rejection if connection fails during connect()
        throw err;
      });
    }

    const pong = await redis.ping();
    const latencyMs = Math.round(performance.now() - startTime);

    if (pong === 'PONG') {
      return {
        status: 'up',
        latencyMs,
      };
    }

    return {
      status: 'down',
      message: 'Unexpected Redis ping response.',
    };
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : 'Unknown Redis error';
    console.error('[Redis Health Check Failed]:', errMessage);

    return {
      status: 'down',
      message: 'Redis service unreachable or ping failed.',
    };
  }
}

export async function closeRedisClient(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
      console.log('[Redis] Connection gracefully closed.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Redis] Error disconnecting client:', msg);
    } finally {
      redisInstance = null;
    }
  }
}
