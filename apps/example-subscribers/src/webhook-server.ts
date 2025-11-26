/**
 * Demonstrates the autotel WebhookSubscriber with two separate servers.
 *
 * Architecture:
 * - Webhook Receiver Server (port 4101): Receives webhook POSTs at `/webhook`
 * - Trigger Server (port 4100): Has `/trigger` endpoint that sends events events
 *   through the WebhookSubscriber, which POSTs to the receiver server
 *
 * This two-server approach avoids the self-referential deadlock that would occur
 * if a single server tried to POST to itself while handling a request.
 *
 * Run: pnpm --filter @jagreehal/example-adapters start:webhook
 *
 * After the servers start, trigger an event with:
 * curl -X POST http://localhost:4100/trigger \
 *   -H "Content-Type: application/json" \
 *   -d '{"name":"webhook.demo.order","attributes":{"orderId":"ord_123","amount":42}}'
 */

import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import 'dotenv/config';
import pino from 'pino';

import { init, shutdown } from 'autotel';
import { Event } from 'autotel/event';
import { trace } from 'autotel/functional';
import { WebhookSubscriber } from 'autotel-subscribers/webhook';

const logger = pino({
  name: 'example-webhook-server',
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

// Webhook Receiver Server Configuration
const receiverPort = Number.parseInt(
  process.env.EXAMPLE_WEBHOOK_RECEIVER_PORT ?? '4101',
  10,
);
const webhookPath = process.env.EXAMPLE_WEBHOOK_PATH ?? '/webhook';
const receiverHealthPath = '/health';

// Trigger Server Configuration
const triggerPort = Number.parseInt(
  process.env.EXAMPLE_WEBHOOK_TRIGGER_PORT ?? '4100',
  10,
);
const triggerPath = '/trigger';
const triggerHealthPath = '/health';

const webhookSecret = process.env.EXAMPLE_WEBHOOK_SECRET ?? 'demo-secret';
const webhookReceiverUrl = `http://localhost:${receiverPort}${webhookPath}`;

init({
  service: 'example-basic-webhook',
  environment: process.env.NODE_ENV ?? 'development',
  version: process.env.APP_VERSION ?? '1.0.0',
  logger,
});

const webhookSubscriber = new WebhookSubscriber({
  url: webhookReceiverUrl,
  headers: {
    'x-example-webhook-secret': webhookSecret,
  },
});

const events = new Event('example-adapters-webhook', {
  subscribers: [webhookSubscriber],
  logger,
});

type TriggerPayload = {
  name?: unknown;
  attributes?: unknown;
};

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function parseJson<T>(req: IncomingMessage): Promise<T | undefined> {
  const raw = await readRequestBody(req);
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn({ error, raw }, 'Failed to parse JSON payload');
    return undefined;
  }
}

// Webhook Receiver Server - receives webhook POSTs from the WebhookSubscriber
const receiverServer = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = (req.url ?? '/').split('?')[0];

  if (method === 'GET' && url === receiverHealthPath) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, server: 'receiver' }));
    return;
  }

  if (method === 'POST' && url === webhookPath) {
    const payload = await parseJson<Record<string, unknown>>(req);
    if (!payload) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
      return;
    }

    logger.info(
      {
        payload,
        headers: req.headers,
      },
      '📬 Webhook Receiver: Received webhook payload',
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

// Trigger Server - sends events events through WebhookSubscriber
const triggerServer = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = (req.url ?? '/').split('?')[0];

  if (method === 'GET' && url === triggerHealthPath) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, server: 'trigger' }));
    return;
  }

  if (method === 'POST' && url === triggerPath) {
    // Wrap in traced function to automatically capture traceId/spanId in events events
    await trace('webhook.trigger', async () => {
      const payload = (await parseJson<TriggerPayload>(req)) ?? {};
      const name =
        typeof payload.name === 'string'
          ? payload.name
          : 'webhook.demo.triggered';
      const attributes =
        typeof payload.attributes === 'object' && payload.attributes !== null
          ? (payload.attributes as Record<string, unknown>)
          : {
              orderId: `ord_${Math.random().toString(36).slice(2, 8)}`,
              amount: 99.5,
              currency: 'USD',
            };

      logger.info(
        {
          event: name,
          attributes,
        },
        '📤 Trigger Server: Sending events event via WebhookSubscriber',
      );

      events.trackEvent(name, {
        ...attributes,
        triggerSource: 'example-basic-webhook',
      });

      // Flush the events queue to ensure the event is sent immediately
      // The events queue processes events asynchronously, so we need to wait
      await events.flush();

      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, event: name }));
    });
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

// Start Webhook Receiver Server
receiverServer.listen(receiverPort, () => {
  const address = receiverServer.address() as AddressInfo | null;
  const actualPort = address?.port ?? receiverPort;

  logger.info(
    {
      port: actualPort,
      webhookEndpoint: `http://localhost:${actualPort}${webhookPath}`,
      healthEndpoint: `http://localhost:${actualPort}${receiverHealthPath}`,
    },
    '📬 Webhook Receiver Server listening',
  );
});

// Start Trigger Server
triggerServer.listen(triggerPort, () => {
  const address = triggerServer.address() as AddressInfo | null;
  const actualPort = address?.port ?? triggerPort;

  logger.info(
    {
      port: actualPort,
      triggerEndpoint: `http://localhost:${actualPort}${triggerPath}`,
      healthEndpoint: `http://localhost:${actualPort}${triggerHealthPath}`,
      webhookDestination: webhookReceiverUrl,
    },
    '📤 Trigger Server listening',
  );

  logger.info(
    `\n✅ Both servers ready!\n\nTrigger an event:\ncurl -X POST http://localhost:${actualPort}${triggerPath} -H "Content-Type: application/json" -d '{"name":"webhook.demo.order","attributes":{"orderId":"ord_123","amount":42}}'\n`,
  );

  // Kick off an initial demo event after both servers are ready
  setTimeout(() => {
    void trace('webhook.demo.init', async () => {
      logger.info('📤 Sending initial demo events event...');
      events.trackEvent('webhook.demo.started', {
        startedAt: new Date().toISOString(),
      });
    });
  }, 1_000).unref();
});

async function closeGracefully(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal');

  await webhookSubscriber.shutdown();
  await shutdown().catch((error) => {
    logger.warn({ error }, 'Failed to flush autotel on shutdown');
  });

  // Close both servers
  await Promise.all([
    new Promise<void>((resolve) => {
      receiverServer.close(() => {
        logger.info('Webhook Receiver Server closed');
        resolve();
      });
    }),
    new Promise<void>((resolve) => {
      triggerServer.close(() => {
        logger.info('Trigger Server closed');
        resolve();
      });
    }),
  ]);

  process.exit(0);
}

process.once('SIGINT', closeGracefully);
process.once('SIGTERM', closeGracefully);

