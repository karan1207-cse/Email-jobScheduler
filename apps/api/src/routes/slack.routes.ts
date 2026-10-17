/**
 * Slack Integration Routes — Milestone 8
 *
 * GET  /auth/slack           → Redirects to Slack OAuth consent screen
 * GET  /auth/slack/callback  → Handles OAuth return, saves credentials
 * GET  /api/slack/status     → Returns connection status (no secrets exposed)
 * POST /api/slack/disconnect → Disconnects Slack integration
 * POST /api/slack/test       → Sends test alert message to Slack
 * POST /api/slack/webhook    → Configures manual incoming webhook
 */
import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import {
  getSlackAuthorizationUrl,
  exchangeSlackCode,
  saveSlackIntegration,
  getSlackStatus,
  disconnectSlack,
  sendSlackMessage,
  setDirectWebhook,
} from '../services/slack.service.js';
import { requireAuth, getCurrentUser } from '../middleware/auth.js';
import { config } from '../config.js';

export const slackRouter = Router();

/**
 * GET /auth/slack
 * Redirect to Slack's OAuth authorization consent screen
 */
slackRouter.get('/auth/slack', (req: Request, res: Response): void => {
  if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) {
    res.status(503).json({
      error: {
        message: 'Slack OAuth is not configured on this server. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env.',
        status: 503,
      },
    });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  if (!req.session) {
    (req as unknown as { session: Record<string, unknown> }).session = {};
  }
  req.session.oauthState = state;

  const authUrl = getSlackAuthorizationUrl(state);
  res.redirect(authUrl);
});

/**
 * GET /auth/slack/callback
 * Slack redirects here after user grants permissions
 */
slackRouter.get('/auth/slack/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    console.warn(`[Slack] OAuth error: ${error}`);
    res.redirect(`${config.FRONTEND_URL}?slack_error=${encodeURIComponent(error)}`);
    return;
  }

  const expectedState = req.session?.oauthState;
  if (!state || state !== expectedState) {
    console.warn('[Slack] OAuth state mismatch — possible CSRF.');
    res.redirect(`${config.FRONTEND_URL}?slack_error=state_mismatch`);
    return;
  }

  if (req.session) {
    delete req.session.oauthState;
  }

  if (!code) {
    res.redirect(`${config.FRONTEND_URL}?slack_error=missing_code`);
    return;
  }

  try {
    const oauthData = await exchangeSlackCode(code);
    const userId = req.session?.user?.userId || '00000000-0000-0000-0000-000000000001';

    await saveSlackIntegration(userId, oauthData);

    // Send a welcoming confirmation message into Slack
    await sendSlackMessage(
      userId,
      `🎉 *ReachInbox Connected!*\nSlack notifications for rate-limiting and job monitoring are now active.`
    );

    res.redirect(`${config.FRONTEND_URL}?slack_connected=1`);
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Slack] OAuth callback failed: ${msg}`);
    res.redirect(`${config.FRONTEND_URL}?slack_error=${encodeURIComponent(msg)}`);
    return;
  }
});

/**
 * GET /api/slack/status
 * Returns connection state without exposing access tokens
 */
slackRouter.get('/api/slack/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = getCurrentUser(req);
    const status = await getSlackStatus(user.userId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to retrieve Slack status.' } });
  }
});

/**
 * POST /api/slack/disconnect
 * Disconnects integration without restarting the application
 */
slackRouter.post('/api/slack/disconnect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = getCurrentUser(req);
    await disconnectSlack(user.userId);
    res.json({ success: true, message: 'Slack integration disconnected successfully.' });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to disconnect Slack.' } });
  }
});

/**
 * POST /api/slack/test
 * Dispatches a test alert to the configured Slack channel
 */
slackRouter.post('/api/slack/test', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = getCurrentUser(req);
    const status = await getSlackStatus(user.userId);

    if (!status.connected) {
      res.status(400).json({ error: { message: 'Slack is not connected. Connect Slack before testing.' } });
      return;
    }

    const testSent = await sendSlackMessage(
      user.userId,
      `🧪 *ReachInbox Test Notification*\nSent by *${user.displayName || user.email}* on ${new Date().toLocaleString()}.\nRate-limit and queue alerts are operational!`
    );

    if (!testSent) {
      res.status(502).json({ error: { message: 'Slack rejected the test notification. Check channel permissions.' } });
      return;
    }

    res.json({ success: true, message: 'Test notification sent to Slack successfully.' });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to dispatch test notification.' } });
  }
});

/**
 * POST /api/slack/webhook
 * Allows directly configuring a Slack Incoming Webhook URL
 */
slackRouter.post('/api/slack/webhook', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = getCurrentUser(req);
    const { webhookUrl, channelName } = req.body as { webhookUrl?: string; channelName?: string };

    if (!webhookUrl || !webhookUrl.startsWith('https://hooks.slack.com/')) {
      res.status(400).json({ error: { message: 'Valid Slack incoming webhook URL is required.' } });
      return;
    }

    await setDirectWebhook(user.userId, webhookUrl, channelName || '#email-alerts');
    res.json({ success: true, message: 'Slack webhook configured successfully.' });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to save Slack webhook.' } });
  }
});
