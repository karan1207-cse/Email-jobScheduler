import express, { type Application } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { rootRouter } from './routes/root.js';
import { healthRouter } from './routes/health.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp(): Application {
  const app = express();

  // CORS configuration
  app.use(
    cors({
      origin: [config.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    })
  );

  app.use(express.json());

  // Mount routers
  app.use(rootRouter);
  app.use(healthRouter);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
