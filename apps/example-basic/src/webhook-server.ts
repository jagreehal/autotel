/**
 * Minimal Node.js server that demonstrates the autotel WebhookSubscriber.
 *
 * Features:
 * - Starts a local webhook receiver (`POST /webhook`)
 * - Exposes a trigger endpoint (`POST /trigger`) that sends events events
 *   through the WebhookSubscriber and immediately posts back to the receiver
 * - Logs the received webhook payloads so you can verify the full round-trip
 *
 * Run: pnpm --filter @jagreehal/example-basic start:webhook
 *
 * After the server starts, trigger an event with:
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

const port = Number.parseInt(process.env.EXAMPLE_WEBHOOK_PORT ?? '4100', 10);
const webhookPath = process.env.EXAMPLE_WEBHOOK_PATH ?? '/webhook';
const triggerPath = process.env.EXAMPLE_WEBHOOK_TRIGGER_PATH ?? '/trigger';
const healthPath = process.env.EXAMPLE_WEBHOOK_HEALTH_PATH ?? '/health';
const baseUrl =
  process.env.EXAMPLE_WEBHOOK_BASE_URL ?? `http://localhost:${port}`;
const webhookSecret = process.env.EXAMPLE_WEBHOOK_SECRET ?? 'demo-secret';

init({
  service: 'example-basic-webhook',
  environment: process.env.NODE_ENV ?? 'development',
  endpoint: process.env.OTLP_ENDPOINT ?? 'http://localhost:4318',
  version: process.env.APP_VERSION ?? '1.0.0',
  logger,
});

const webhookSubscriber = new WebhookSubscriber({
  url: `${baseUrl}${webhookPath}`,
  headers: {
    'x-example-webhook-secret': webhookSecret,
  },
});

const events = new Event('example-basic', {
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

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = (req.url ?? '/').split('?')[0];

  if (method === 'GET' && url === healthPath) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
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
      'Received webhook payload',
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (method === 'POST' && url === triggerPath) {
    // Wrap in traced function to automatically capture traceId/spanId in events events
    const handleTrigger = trace('webhook.trigger', async () => {
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
        'Sending events event via WebhookSubscriber',
      );

      events.trackEvent(name, {
        ...attributes,
        triggerSource: 'example-basic-webhook',
      });

      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, event: name }));
    });

    await handleTrigger;
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.listen(port, () => {
  const address = server.address() as AddressInfo | null;
  const host = address?.address ?? 'localhost';
  const actualPort = address?.port ?? port;

  logger.info(
    {
      webhookEndpoint: `${baseUrl}${webhookPath}`,
      triggerEndpoint: `${baseUrl}${triggerPath}`,
      healthEndpoint: `${baseUrl}${healthPath}`,
    },
    'Webhook example server listening',
  );

  logger.info(
    `Try: curl -X POST ${baseUrl}${triggerPath} -H "Content-Type: application/json" -d '{"name":"webhook.demo.order","attributes":{"orderId":"ord_123","amount":42}}'`,
  );

  // Kick off an initial demo event after the server starts up.
  setTimeout(() => {
    // Wrap in traced function to automatically capture traceId/spanId
    const sendDemoEvent = trace('webhook.demo.init', async () => {
      logger.info('Sending initial demo events event');
      events.trackEvent('webhook.demo.started', {
        startedAt: new Date().toISOString(),
      });
    });

    void sendDemoEvent;
  }, 1_000).unref();

  logger.info(
    { host, port: actualPort },
    'Server ready. Press Ctrl+C to stop.',
  );
});

async function closeGracefully(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal');
  await webhookSubscriber.shutdown();
  await shutdown().catch((error) => {
    logger.warn({ error }, 'Failed to flush autotel on shutdown');
  });

  await new Promise<void>((resolve) => {
    server.close(() => {
      logger.info('HTTP server closed');
      resolve();
    });
  });

  process.exit(0);
}

process.once('SIGINT', closeGracefully);
process.once('SIGTERM', closeGracefully);

