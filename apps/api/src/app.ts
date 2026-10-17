import express, { type Application } from 'express';
import cors from 'cors';
import session from 'express-session';
import { config } from './config.js';
import { rootRouter } from './routes/root.js';
import { healthRouter } from './routes/health.js';
import { emailRouter } from './routes/email.routes.js';
import { schedulerRouter } from './routes/scheduler.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp(): Application {
  const app = express();

  // CORS configuration — must come before session so the preflight OPTIONS
  // is handled before any cookie processing
  app.use(
    cors({
      origin: [config.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      exposedHeaders: ['Idempotent-Replay'],
      credentials: true, // Required for cookies to be sent cross-origin
    })
  );

  // Session middleware — HTTP-only, SameSite=Lax cookie
  // In production set secure: true and use a real session store (e.g. Redis-backed)
  app.use(
    session({
      name: 'reachinbox.sid',
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  );

  app.use(express.json());

  // Mount routers
  app.use(rootRouter);
  app.use(healthRouter);
  app.use(authRouter);   // Auth routes: /auth/google, /auth/me, /auth/logout
  app.use(emailRouter);
  app.use(schedulerRouter);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
