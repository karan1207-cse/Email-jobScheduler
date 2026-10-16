/**
 * Prisma Client singleton for the Worker process.
 */
import { PrismaClient } from '@prisma/client';
import { workerConfig } from './config.js';

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: { url: workerConfig.DATABASE_URL },
      },
      log: workerConfig.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return prisma;
}

export async function closePrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    console.log('[Worker Prisma] Disconnected.');
    prisma = null;
  }
}
