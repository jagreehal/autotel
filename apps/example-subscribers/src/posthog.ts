/**
 * Example: Send events to PostHog with the official adapter.
 *
 * Requirements:
 * - POSTHOG_KEY (Project API key that starts with phc_)
 * - POSTHOG_HOST (optional, defaults to https://us.i.posthog.com)
 * - POSTHOG_ENV_ID (optional, tagged on each events payload)
 *
 * The script simulates a checkout flow and demonstrates:
 * - Tracking lifecycle events (view, add_to_cart, checkout)
 * - Funnel steps for conversion monitoring
 * - Outcome tracking for payment success/failure
 * - Value tracking for revenue attribution
 */

import { randomUUID } from 'node:crypto';

import 'dotenv/config';
import pino from 'pino';

import { init, shutdown } from 'autotel';
import { Event } from 'autotel/event';
import { trace } from 'autotel/functional';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';

const logger = pino({
  name: 'example-posthog',
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

const posthogKey = process.env.POSTHOG_KEY;
const posthogHost = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';
const posthogEnvId = process.env.POSTHOG_ENV_ID || 'development';

if (!posthogKey) {
  logger.error('POSTHOG_KEY is required. Check apps/example-adapters/.env.example');
  process.exit(1);
}

init({
  service: 'example-adapters-posthog',
  environment: process.env.NODE_ENV ?? 'development',
  version: process.env.APP_VERSION ?? '1.0.0',
  logger,
});

const posthogSubscriber = new PostHogSubscriber({
  apiKey: posthogKey,
  host: posthogHost,
});

const events = new Event('example-adapters-posthog', {
  subscribers: [posthogSubscriber],
  logger,
});

type DemoOrder = {
  id: string;
  userId: string;
  amount: number;
  currency: 'USD' | 'EUR';
  items: number;
};

function createDemoOrder(userId: string): DemoOrder {
  return {
    id: `ord_${randomUUID().slice(0, 8)}`,
    userId,
    amount: Number((Math.random() * 250 + 25).toFixed(2)),
    currency: Math.random() > 0.8 ? 'EUR' : 'USD',
    items: Math.floor(Math.random() * 3) + 1,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runDemo(): Promise<void> {
  logger.info(
    {
      posthogHost,
      posthogEnvId,
    },
    'Sending sample events to PostHog',
  );

  for (let i = 0; i < 3; i++) {
    await trace('posthog.demo.checkout', async (ctx) => {
      const userId = `user_${randomUUID().slice(0, 6)}`;
      const order = createDemoOrder(userId);

      ctx.setAttribute('demo.iteration', i + 1);
      ctx.setAttribute('demo.userId', userId);

      events.trackEvent('posthog.demo.product_viewed', {
        userId,
        productId: `prod_${(i + 1).toString().padStart(2, '0')}`,
        environmentId: posthogEnvId,
      });

      events.trackFunnelStep('posthog.checkout', 'started', {
        userId,
        environmentId: posthogEnvId,
      });

      events.trackEvent('posthog.demo.add_to_cart', {
        userId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        environmentId: posthogEnvId,
      });

      // Randomize a failure to demonstrate PostHog outcome tracking.
      const paymentSucceeded = Math.random() > 0.2;

      if (!paymentSucceeded) {
        events.trackOutcome('posthog.payment', 'failure', {
          userId,
          orderId: order.id,
          reason: 'insufficient_funds',
          environmentId: posthogEnvId,
        });
        return;
      }

      events.trackOutcome('posthog.payment', 'success', {
        userId,
        orderId: order.id,
        paymentProvider: 'stripe',
        environmentId: posthogEnvId,
      });

      events.trackFunnelStep('posthog.checkout', 'completed', {
        userId,
        orderId: order.id,
        environmentId: posthogEnvId,
      });

      events.trackValue('posthog.revenue', order.amount, {
        orderId: order.id,
        userId,
        currency: order.currency,
        environmentId: posthogEnvId,
      });

      events.trackEvent('posthog.demo.order_completed', {
        ...order,
        environmentId: posthogEnvId,
      });
    });

    await sleep(500);
  }

  logger.info('✅ Demo complete. Check your PostHog project for the events.');
}

let closing = false;

async function closeGracefully(signal?: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  if (signal) {
    logger.info({ signal }, 'Received shutdown signal');
  }

  await posthogSubscriber.shutdown().catch((error) => {
    logger.warn({ error }, 'Failed to flush PostHog adapter');
  });

  await shutdown().catch((error) => {
    logger.warn({ error }, 'Failed to flush autotel on shutdown');
  });

  process.exit(0);
}

process.once('SIGINT', closeGracefully);
process.once('SIGTERM', closeGracefully);

runDemo()
  .then(() => closeGracefully())
  .catch((error) => {
    logger.error({ error }, 'PostHog example failed');
    void closeGracefully();
  });
