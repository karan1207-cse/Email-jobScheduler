import express, { type Application } from 'express';
import cors from 'cors';
import session from 'express-session';
import { config } from './config.js';
import { rootRouter } from './routes/root.js';
import { healthRouter } from './routes/health.js';
import { emailRouter } from './routes/email.routes.js';
import { schedulerRouter } from './routes/scheduler.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { slackRouter } from './routes/slack.routes.js';
import { searchRouter } from './routes/search.routes.js';
import { createQueueDashboard, DASHBOARD_BASE_PATH } from './queue/dashboard.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createRedisSessionStore } from './auth/redis-session-store.js';

export function createApp(): Application {
  const app = express();
  app.disable('x-powered-by');

  // Behind a hosting proxy (Render, Railway, Heroku, nginx) the real client IP
  // and https scheme come from X-Forwarded-*. Needed for secure cookies.
  // TRUST_PROXY=1 trusts one proxy hop; it is on by default in production and
  // on Render (which sets RENDER=true on every service).
  const onRender = process.env.RENDER === 'true';
  const trustProxy =
    process.env.TRUST_PROXY ?? (config.NODE_ENV === 'production' || onRender ? '1' : '');
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  // When the dashboard and API are on different sites (for example two
  // *.onrender.com services), browsers only send the session cookie on API
  // calls if it is SameSite=None; Secure. Set COOKIE_SAMESITE=none for that;
  // it is the default on Render, where onrender.com subdomains are separate sites.
  const sameSite = (process.env.COOKIE_SAMESITE || (onRender ? 'none' : 'lax')).toLowerCase() as
    | 'lax'
    | 'strict'
    | 'none';
  const secureCookie = config.NODE_ENV === 'production' || sameSite === 'none';

  // Baseline browser security headers for API and OAuth responses.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

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

  // Session middleware — HTTP-only cookie. Sessions live in Redis so sign-ins
  // survive API restarts and deploys; tests keep the in-memory store.
  app.use(
    session({
      name: 'reachinbox.sid',
      store: config.NODE_ENV === 'test' ? undefined : createRedisSessionStore(config.REDIS_URL),
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite,
        secure: secureCookie,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  );

  app.use(express.json({ limit: '12mb' }));

  // Mount routers
  app.use(rootRouter);
  app.use(healthRouter);
  app.use(authRouter);   // Auth routes: /auth/google, /auth/me, /auth/logout
  app.use(slackRouter);  // Slack routes: /auth/slack, /api/slack/*
  app.use(emailRouter);
  app.use(schedulerRouter);
  app.use(searchRouter);  // Search routes: /api/search/emails, /api/search/rebuild

  // BullMQ queue dashboard — /admin/queues (localhost-only in dev, token-protected in prod)
  const dashboardRouter = createQueueDashboard();
  if (dashboardRouter) {
    app.use(DASHBOARD_BASE_PATH, dashboardRouter);
    console.log(`[BullBoard] Queue dashboard available at ${DASHBOARD_BASE_PATH}`);
  }

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
