/**
 * Slack Rate-Limit Alerting Module for Worker — Milestone 8
 *
 * Dispatches automated alerts to connected Slack channels when workers
 * encounter rate limiting or send pacing delays.
 *
 * FEATURES:
 * - Redis-backed 5-minute deduplication window to avoid notification spam
 * - Non-blocking asynchronous execution (never delays or fails email jobs)
 * - Detailed Block Kit markdown formatting with scope, limits, and retry delay
 */
import type { Redis } from 'ioredis';
import { getPrisma } from './prisma.js';

export interface AlertOptions {
  scope: string;
  hourlyLimit: number;
  retryAfterMs: number;
  reason?: string;
}

/**
 * Dispatches a rate-limit alert to Slack if deduplication allows
 */
export async function dispatchRateLimitAlert(
  redis: Redis,
  options: AlertOptions
): Promise<boolean> {
  const { scope, hourlyLimit, retryAfterMs, reason } = options;

  try {
    const dedupKey = `rl:slack_alert_dedup:${scope}`;
    // Deduplicate: allow only 1 alert per scope per 300 seconds (5 minutes)
    if (typeof redis.set === 'function') {
      const acquired = await redis.set(dedupKey, '1', 'EX', 300, 'NX');
      if (!acquired) {
        // Alert already sent recently for this window — deduplicate
        return false;
      }
    }

    const prisma = getPrisma();
    if (!prisma.slackIntegration) {
      return false;
    }

    // Query active Slack integrations from the database
    const integrations = await prisma.slackIntegration.findMany({
      where: { isActive: true },
      take: 5,
    });

    if (integrations.length === 0) {
      return false;
    }

    const retrySec = Math.max(1, Math.round(retryAfterMs / 1000));
    const title = '⚠️ ReachInbox Sending Rate Limit Exceeded';
    const description = reason || `Hourly quota limit of ${hourlyLimit} emails/hour was reached.`;

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: title },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${description}*\nBackpressure engaged across concurrent workers to maintain sender reputation.`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Scope:*\n\`${scope}\`` },
          { type: 'mrkdwn', text: `*Hourly Cap:*\n${hourlyLimit} emails/hr` },
          { type: 'mrkdwn', text: `*Retry In:*\n~${retrySec}s` },
          { type: 'mrkdwn', text: `*Deduplication:*\n5-Minute Window` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `ReachInbox Distributed Worker Engine • ${new Date().toISOString()}`,
          },
        ],
      },
    ];

    // Dispatch to all active integrations
    for (const integration of integrations) {
      try {
        if (integration.incomingWebhookUrl) {
          await fetch(integration.incomingWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `${title}: ${description}`, blocks }),
          });
        } else if (integration.accessToken && integration.channelId) {
          await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${integration.accessToken}`,
            },
            body: JSON.stringify({
              channel: integration.channelId,
              text: `${title}: ${description}`,
              blocks,
            }),
          });
        }
      } catch (postErr) {
        console.warn(`[Worker Slack] Could not post to integration ${integration.id}:`, postErr);
      }
    }

    console.log(`[Worker Slack] 📢 Dispatched rate-limit alert to ${integrations.length} Slack channel(s).`);
    return true;
  } catch (err) {
    // Non-fatal — log and continue
    console.warn('[Worker Slack] Error during alert dispatch:', err);
    return false;
  }
}
