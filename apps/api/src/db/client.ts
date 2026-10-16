import { Pool } from 'pg';
import type { DependencyHealth } from '@reachinbox/shared';
import { config } from '../config.js';

let poolInstance: Pool | null = null;

export function getDatabasePool(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: config.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      max: 10,
    });

    poolInstance.on('error', (err: Error) => {
      // Log generic pool error without printing connection string or password
      console.error('[PostgreSQL Pool Error]', err.message);
    });
  }

  return poolInstance;
}

export async function checkDatabaseHealth(): Promise<DependencyHealth> {
  const pool = getDatabasePool();
  const startTime = performance.now();

  try {
    const result = await pool.query('SELECT 1 AS health_check');
    const latencyMs = Math.round(performance.now() - startTime);

    if (result.rows && result.rows.length > 0) {
      return {
        status: 'up',
        latencyMs,
      };
    }

    return {
      status: 'down',
      message: 'Unexpected empty query result from database.',
    };
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : 'Unknown database error';
    // Log internal error for debugging locally, but return sanitized safe message
    console.error('[Database Health Check Failed]:', errMessage);

    return {
      status: 'down',
      message: 'Database service unreachable or query failed.',
    };
  }
}

export async function closeDatabasePool(): Promise<void> {
  if (poolInstance) {
    try {
      await poolInstance.end();
      console.log('[PostgreSQL] Connection pool gracefully closed.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[PostgreSQL] Error closing connection pool:', msg);
    } finally {
      poolInstance = null;
    }
  }
}
