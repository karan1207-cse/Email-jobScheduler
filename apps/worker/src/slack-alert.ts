/**
 * Slack Rate-Limit Alerting Module for Worker — Milestone 8
 *
 * Dispatches automated alerts to connected Slack channels when workers
 * encounter rate limiting or send pacing delays.
 *
 * FEATURES:
 * - Redis-backed deduplication: one alert per sender per clock-hour window
 * - Non-blocking asynchronous execution (never delays or fails email jobs)
 * - Detailed Block Kit markdown formatting with scope, limits, and retry delay
 */
import type { Redis } from 'ioredis';
import { getPrisma } from './prisma.js';

export interface AlertOptions {
  /** Owner of the Slack connection to notify. Defaults to `scope`. */
  userId?: string;
  /** Rate-limit scope that was hit: a sender id, or 'global'. */
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
  const userId = options.userId ?? scope;
  // One alert per user, scope and clock hour: the first hit in a window notifies
  // immediately, later deferrals in that window stay quiet.
  const window = Math.floor(Date.now() / 3_600_000);
  const dedupKey = `rl:slack_alert_dedup:${userId}:${scope}:${window}`;

  try {
    const prisma = getPrisma();
    if (!prisma.slackIntegration) {
      return false;
    }

    // Looked up on every hit (no caching), so connecting or disconnecting Slack
    // takes effect immediately without a worker restart. Not connected → no-op.
    const integrations = await prisma.slackIntegration.findMany({
      where: { isActive: true, userId },
      take: 1,
    });

    if (integrations.length === 0) {
      return false;
    }

    if (typeof redis.set === 'function') {
      const acquired = await redis.set(dedupKey, '1', 'EX', 3600, 'NX');
      if (!acquired) {
        // Alert already sent for this window — deduplicate
        return false;
      }
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
          { type: 'mrkdwn', text: `*Alerts:*\nOnce per hour window` },
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

    let delivered = 0;
    for (const integration of integrations) {
      try {
        if (integration.incomingWebhookUrl) {
          const response = await fetch(integration.incomingWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `${title}: ${description}`, blocks }),
          });
          if (response.ok) delivered += 1;
          else console.warn(`[Worker Slack] Webhook returned HTTP ${response.status}.`);
        } else if (integration.accessToken && integration.channelId) {
          const response = await fetch('https://slack.com/api/chat.postMessage', {
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
          const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
          if (response.ok && result?.ok) delivered += 1;
          else console.warn(`[Worker Slack] chat.postMessage rejected the alert: ${result?.error || response.statusText}`);
        }
      } catch (postErr) {
        console.warn(`[Worker Slack] Could not post to integration ${integration.id}:`, postErr);
      }
    }

    if (delivered > 0) {
      console.log(`[Worker Slack] 📢 Delivered rate-limit alert to ${delivered} Slack channel(s).`);
    } else if (typeof redis.del === 'function') {
      // Nothing was delivered; let the next hit in this window try again.
      await redis.del(dedupKey).catch(() => 0);
    }
    return delivered > 0;
  } catch (err) {
    // Non-fatal — log and continue
    console.warn('[Worker Slack] Error during alert dispatch:', err);
    return false;
  }
}
