import type { Server } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closeDatabasePool } from './db/client.js';
import { closeRedisClient } from './redis/client.js';

const app = createApp();

let server: Server | null = null;
let isShuttingDown = false;

async function startServer(): Promise<void> {
  try {
    server = app.listen(config.PORT, () => {
      console.log(`=======================================================`);
      console.log(`🚀 ReachInbox API Server running on port ${config.PORT}`);
      console.log(`📍 Environment: ${config.NODE_ENV}`);
      console.log(`📡 Root URL:    http://localhost:${config.PORT}/`);
      console.log(`🩺 Health URL:  http://localhost:${config.PORT}/health`);
      console.log(`=======================================================`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Fatal Startup Error] Port ${config.PORT} is already in use. Please free the port or change PORT in .env.`);
      } else {
        console.error('[Fatal Startup Error] Failed to start HTTP server:', err.message);
      }
      process.exit(1);
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Fatal Startup Error]:', msg);
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] Received ${signal}. Initiating graceful termination...`);

  const shutdownTimeout = setTimeout(() => {
    console.error('[Shutdown] Forcefully terminating process after 10s timeout.');
    process.exit(1);
  }, 10000);

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => {
          if (err) return reject(err);
          console.log('[HTTP Server] Stopped accepting new requests.');
          resolve();
        });
      });
    }

    await Promise.all([
      closeDatabasePool(),
      closeRedisClient(),
    ]);

    clearTimeout(shutdownTimeout);
    console.log('[Shutdown] All connections cleanly closed. Exiting.');
    process.exit(0);
  } catch (error: unknown) {
    clearTimeout(shutdownTimeout);
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Shutdown Error] Encountered error during shutdown:', msg);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('uncaughtException', (err: Error) => {
  console.error('[Uncaught Exception]:', err.message);
  void gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Unhandled Rejection]:', reason);
  void gracefulShutdown('unhandledRejection');
});

void startServer();
