import express, { type Application } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { rootRouter } from './routes/root.js';
import { healthRouter } from './routes/health.js';
import { emailRouter } from './routes/email.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp(): Application {
  const app = express();

  // CORS configuration
  app.use(
    cors({
      origin: [config.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      exposedHeaders: ['Idempotent-Replay'],
      credentials: true,
    })
  );

  app.use(express.json());

  // Mount routers
  app.use(rootRouter);
  app.use(healthRouter);
  app.use(emailRouter);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
