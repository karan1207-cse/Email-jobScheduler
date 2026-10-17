/**
 * Slack Integration & Rate-Limit Alerting Service — Milestone 8
 *
 * Implements:
 * 1. Real Slack OAuth 2.0 exchange (oauth.v2.access)
 * 2. Safe database persistence of credentials per user
 * 3. Rate-limit alert dispatching with Redis-based deduplication
 * 4. Connect, disconnect, and test notifications
 *
 * SECURITY:
 * - Access tokens and incoming webhook URLs are never returned to frontend
 * - OAuth state parameter prevents CSRF
 */
import { getPrismaClient } from '../db/prisma.js';
import { getRedisClient } from '../redis/client.js';
import { config } from '../config.js';

export interface SlackStatusResult {
  connected: boolean;
  configured: boolean;
  teamName?: string | null;
  channelName?: string | null;
  teamId?: string | null;
}

export interface SlackOAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  team?: {
    id: string;
    name: string;
  };
  incoming_webhook?: {
    url: string;
    channel: string;
    channel_id: string;
    configuration_url: string;
  };
}

/**
 * Generates Slack OAuth 2.0 authorization URL
 */
export function getSlackAuthorizationUrl(state: string): string {
  const scopes = ['incoming-webhook', 'chat:write'];
  const params = new URLSearchParams({
    client_id: config.SLACK_CLIENT_ID,
    scope: scopes.join(','),
    redirect_uri: config.SLACK_REDIRECT_URI,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/**
 * Exchanges authorization code for access token & incoming webhook from Slack API
 */
export async function exchangeSlackCode(code: string): Promise<SlackOAuthAccessResponse> {
  const params = new URLSearchParams({
    client_id: config.SLACK_CLIENT_ID,
    client_secret: config.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: config.SLACK_REDIRECT_URI,
  });

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Slack API HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as SlackOAuthAccessResponse;
  if (!data.ok) {
    throw new Error(`Slack OAuth error: ${data.error || 'Failed to exchange code.'}`);
  }

  return data;
}

/**
 * Connects Slack credentials to the user record
 */
export async function saveSlackIntegration(
  userId: string,
  oauthData: SlackOAuthAccessResponse
): Promise<void> {
  const prisma = getPrismaClient();

  const teamId = oauthData.team?.id || 'unknown_team';
  const teamName = oauthData.team?.name || null;
  const channelId = oauthData.incoming_webhook?.channel_id || null;
  const channelName = oauthData.incoming_webhook?.channel || null;
  const accessToken = oauthData.access_token || '';
  const incomingWebhookUrl = oauthData.incoming_webhook?.url || null;

  await prisma.slackIntegration.upsert({
    where: { userId },
    update: {
      teamId,
      teamName,
      channelId,
      channelName,
      accessToken,
      incomingWebhookUrl,
      isActive: true,
    },
    create: {
      userId,
      teamId,
      teamName,
      channelId,
      channelName,
      accessToken,
      incomingWebhookUrl,
      isActive: true,
    },
  });

  console.log(`[Slack] Connected workspace '${teamName}' for user '${userId}'`);
}

/**
 * Configures a direct incoming webhook URL (for local testing without full OAuth app)
 */
export async function setDirectWebhook(
  userId: string,
  webhookUrl: string,
  channelName: string = '#general'
): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.slackIntegration.upsert({
    where: { userId },
    update: {
      teamId: 'manual_webhook',
      teamName: 'Custom Webhook Workspace',
      channelName,
      accessToken: 'manual',
      incomingWebhookUrl: webhookUrl.trim(),
      isActive: true,
    },
    create: {
      userId,
      teamId: 'manual_webhook',
      teamName: 'Custom Webhook Workspace',
      channelName,
      accessToken: 'manual',
      incomingWebhookUrl: webhookUrl.trim(),
      isActive: true,
    },
  });

  console.log(`[Slack] Direct webhook configured for user '${userId}'`);
}

/**
 * Returns connection status without exposing secrets to client
 */
export async function getSlackStatus(userId: string): Promise<SlackStatusResult> {
  const prisma = getPrismaClient();
  const configured = Boolean(config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET);

  const integration = await prisma.slackIntegration.findUnique({
    where: { userId },
  });

  if (!integration || !integration.isActive) {
    return {
      connected: false,
      configured,
      teamName: null,
      channelName: null,
      teamId: null,
    };
  }

  return {
    connected: true,
    configured,
    teamName: integration.teamName,
    channelName: integration.channelName,
    teamId: integration.teamId,
  };
}

/**
 * Disconnects Slack integration
 */
export async function disconnectSlack(userId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.slackIntegration.updateMany({
    where: { userId },
    data: { isActive: false },
  });
  console.log(`[Slack] Disconnected integration for user '${userId}'`);
}

/**
 * Sends a message to the connected Slack channel
 */
export async function sendSlackMessage(
  userId: string | null,
  text: string,
  blocks?: unknown[]
): Promise<boolean> {
  const prisma = getPrismaClient();

  const integration = userId
    ? await prisma.slackIntegration.findUnique({ where: { userId } })
    : await prisma.slackIntegration.findFirst({ where: { isActive: true } });

  if (!integration || !integration.isActive) {
    console.log('[Slack] No active Slack integration found to send message.');
    return false;
  }

  try {
    if (integration.incomingWebhookUrl) {
      const payload: Record<string, unknown> = { text };
      if (blocks) payload.blocks = blocks;

      const res = await fetch(integration.incomingWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn(`[Slack] Webhook post failed: ${res.status} ${res.statusText}`);
        return false;
      }
      return true;
    }

    if (integration.accessToken && integration.channelId) {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${integration.accessToken}`,
        },
        body: JSON.stringify({
          channel: integration.channelId,
          text,
          ...(blocks ? { blocks } : {}),
        }),
      });

      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        console.warn(`[Slack] chat.postMessage failed: ${json.error}`);
        return false;
      }
      return true;
    }

    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Slack] Failed to dispatch notification: ${msg}`);
    return false;
  }
}

/**
 * Automated Rate-Limit Alert with Redis-backed Deduplication
 * Deduplication window: 5 minutes (300 seconds) per rate-limit scope
 */
export async function notifyRateLimitExceeded(
  scope: string,
  limitPerHour: number,
  retryAfterMs: number
): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const dedupKey = `rl:slack_alert_dedup:${scope}`;

    // Atomically check and set deduplication key with 5-minute TTL
    const acquired = await redis.set(dedupKey, '1', 'EX', 300, 'NX');
    if (!acquired) {
      // Alert already sent within last 5 minutes — deduplicated
      return false;
    }

    const retrySec = Math.round(retryAfterMs / 1000);
    const message = `🚨 *ReachInbox Rate Limit Alert*\n` +
      `Sending limit of *${limitPerHour} emails/hour* has been reached for scope \`${scope}\`.\n` +
      `Concurrent jobs are being safely deferred and will resume automatically in ~${retrySec}s.`;

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ ReachInbox Rate Limit Triggered' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Hourly quota limit of *${limitPerHour} emails/hour* was exceeded. Backpressure has engaged to protect sender reputation.`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Scope:*\n\`${scope}\`` },
          { type: 'mrkdwn', text: `*Retry In:*\n~${retrySec} seconds` },
          { type: 'mrkdwn', text: `*Queue Action:*\nBullMQ Job Deferred` },
          { type: 'mrkdwn', text: `*Alert Deduplication:*\n5-Minute Window` },
        ],
      },
    ];

    console.log(`[Slack] Rate limit reached. Dispatching alert for scope '${scope}'...`);
    return await sendSlackMessage(null, message, blocks);
  } catch (err) {
    console.warn('[Slack] Failed to send rate-limit alert:', err);
    return false;
  }
}
