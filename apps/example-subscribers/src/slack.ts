/**
 * Example: Send analytics alerts to Slack using the SlackSubscriber.
 *
 * Requirements:
 * - SLACK_WEBHOOK_URL (Incoming webhook from your Slack app)
 * - SLACK_CHANNEL_ID (optional override, e.g. #analytics or C123ABC456)
 *
 * The adapter formats analytics payloads into rich Slack attachments and
 * demonstrates:
 * - Filtering events to avoid noisy channels
 * - Outcome tracking for failure alerts
 * - Value tracking for revenue notifications
 */

import { randomUUID } from 'node:crypto';

import 'dotenv/config';
import pino from 'pino';

import { init, shutdown } from 'autotel';
import { Event } from 'autotel/event';
import { trace } from 'autotel/functional';
import { SlackSubscriber } from 'autotel-subscribers/slack';
import type { EventPayload } from 'autotel-subscribers';

const logger = pino({
  name: 'example-slack',
  level: process.env.LOG_LEVEL ?? 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

const slackWebhookUrl =
  process.env.SLACK_WEBHOOK_URL ?? process.env.SLACK_BOT_TOKEN;
const slackChannel = process.env.SLACK_CHANNEL_ID;

if (!slackWebhookUrl) {
  logger.error(
    'SLACK_WEBHOOK_URL is required. See apps/example-adapters/.env.example',
  );
  process.exit(1);
}

init({
  service: 'example-adapters-slack',
  environment: process.env.NODE_ENV ?? 'development',
  version: process.env.APP_VERSION ?? '1.0.0',
  logger,
});

const slackSubscriber = new SlackSubscriber({
  webhookUrl: slackWebhookUrl,
  channel: slackChannel,
  username: 'Telemetry Demo Bot',
  iconEmoji: ':satellite:',
  includeAttributes: true,
  filter: (payload: EventPayload) => {
    if (payload.type === 'outcome') {
      // Always alert on failures
      return payload.outcome !== 'success';
    }

    // Only send events that explicitly want Slack visibility
    return Boolean(payload.attributes?.notifySlack);
  },
});

const analytics = new Event('example-adapters-slack', {
  subscribers: [slackSubscriber],
  logger,
});

type Customer = {
  id: string;
  region: 'na' | 'eu' | 'apac';
  plan: 'starter' | 'growth' | 'enterprise';
};

function createCustomer(): Customer {
  const regions: Customer['region'][] = ['na', 'eu', 'apac'];
  const plans: Customer['plan'][] = ['starter', 'growth', 'enterprise'];

  const region = regions[Math.floor(Math.random() * regions.length)]!;
  const plan = plans[Math.floor(Math.random() * plans.length)]!;

  return {
    id: `cust_${randomUUID().slice(0, 6)}`,
    region,
    plan,
  };
}

function fakeOrderTotal(plan: Customer['plan']): number {
  switch (plan) {
    case 'enterprise':
      return Number((Math.random() * 1500 + 2500).toFixed(2));
    case 'growth':
      return Number((Math.random() * 400 + 700).toFixed(2));
    default:
      return Number((Math.random() * 150 + 100).toFixed(2));
  }
}

async function simulateSlackAlerts(): Promise<void> {
  logger.info('Sending demo alerts to Slack');

  for (let i = 0; i < 3; i++) {
    await trace('slack.demo.order', async (ctx) => {
      const customer = createCustomer();
      const total = fakeOrderTotal(customer.plan);
      const highValue = total > 500;

      ctx.setAttribute('demo.iteration', i + 1);
      ctx.setAttribute('customer.id', customer.id);

      analytics.trackEvent('slack.demo.order_received', {
        customerId: customer.id,
        plan: customer.plan,
        region: customer.region,
        total,
        currency: 'USD',
        orderId: `ord_${randomUUID().slice(0, 8)}`,
        notifySlack: highValue,
      });

      analytics.trackValue('slack.demo.revenue', total, {
        customerId: customer.id,
        plan: customer.plan,
        region: customer.region,
      });

      const fulfillmentSucceeded = Math.random() > 0.3;
      if (!fulfillmentSucceeded) {
        analytics.trackOutcome('slack.fulfillment', 'failure', {
          customerId: customer.id,
          region: customer.region,
          error: 'inventory_shortage',
        });
        return;
      }

      analytics.trackOutcome('slack.fulfillment', 'success', {
        customerId: customer.id,
        region: customer.region,
      });
    });
  }

  logger.info('✅ Slack alerts sent (check your channel)');
}

let closing = false;

async function closeGracefully(signal?: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  if (signal) {
    logger.info({ signal }, 'Received shutdown signal');
  }

  await slackSubscriber.shutdown().catch((error: unknown) => {
    logger.warn({ error }, 'Failed to flush Slack subscriber');
  });

  await shutdown().catch((error) => {
    logger.warn({ error }, 'Failed to flush autotel on shutdown');
  });

  process.exit(0);
}

process.once('SIGINT', closeGracefully);
process.once('SIGTERM', closeGracefully);

simulateSlackAlerts()
  .then(() => closeGracefully())
  .catch((error) => {
    logger.error({ error }, 'Slack example failed');
    void closeGracefully();
  });