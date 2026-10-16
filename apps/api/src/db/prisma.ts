import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      datasourceUrl: config.DATABASE_URL,
      log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  return prismaInstance;
}

export async function closePrismaClient(): Promise<void> {
  if (prismaInstance) {
    try {
      await prismaInstance.$disconnect();
      console.log('[Prisma] Client disconnected gracefully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Prisma] Error disconnecting client:', msg);
    } finally {
      prismaInstance = null;
    }
  }
}
