import express, { type ErrorRequestHandler } from 'express';
import { createStructuredError, trace } from 'autotel';
import { createDatadogConfig } from 'autotel-backends/datadog';
import { otlpRelay } from 'autotel-backends/relay';
import { datadog } from './instrumentation';

const app = express();

// The browser's spans and logs, forwarded to Datadog with the API key added
// here. The relay is a Fetch handler, so Express hands it a Request.
const relay = otlpRelay(
  createDatadogConfig({
    ...datadog,
    service: 'example-datadog-react-express-web',
  }),
);
app.post(
  '/otel/v1/:signal',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
    }
    // SAFETY: express.raw() above leaves the body as a Buffer.
    const body = req.body as Buffer;
    const response = await relay(
      new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
        method: 'POST',
        headers,
        body: new Uint8Array(body),
      }),
    );
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  },
);

/**
 * Datadog RUM's `proxy`: the page sends RUM through its own origin, which
 * survives ad blockers. Forwarded to Datadog's browser intake. Only the
 * intake's own paths, so this is not an open proxy.
 */
const rumEvents: unknown[] = [];
app.post(
  '/rum-intake',
  express.raw({ type: '*/*', limit: '5mb' }),
  async (req, res) => {
    const forward = String(req.query.ddforward ?? '');
    if (!forward.startsWith('/api/v2/')) {
      res.status(400).end();
      return;
    }
    // SAFETY: express.raw() above leaves the body as a Buffer.
    const body = req.body as Buffer;
    // In development, keep the RUM events (newline-delimited JSON) so the
    // smoke test can read what RUM sent; replay segments are multipart.
    if (
      process.env.NODE_ENV !== 'production' &&
      forward.startsWith('/api/v2/rum')
    ) {
      for (const line of body.toString('utf8').split('\n')) {
        try {
          if (line.trim()) rumEvents.push(JSON.parse(line));
        } catch {
          // Not an event line.
        }
      }
    }
    try {
      const upstream = await fetch(
        `https://browser-intake-${datadog.site}${forward}`,
        {
          method: 'POST',
          headers: {
            'content-type': req.get('content-type') ?? 'text/plain',
            'x-forwarded-for': req.ip ?? '',
          },
          body: new Uint8Array(body),
        },
      );
      res.status(upstream.status).end();
    } catch {
      res.status(502).end();
    }
  },
);
app.get('/rum-events', (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).end();
    return;
  }
  res.json(rumEvents);
});

app.use(express.json());

app.get('/api/orders', (_req, res) => {
  res.json([
    { id: 'ord_1', item: 'Vinyl, limited press', total: 42 },
    { id: 'ord_2', item: 'Tour poster', total: 18 },
  ]);
});

// A business failure: the request is fine, the answer is no. Express 4 does
// not forward a rejected async handler, so it is passed to `next` by hand.
app.post('/api/checkout', (_req, _res, next) => {
  trace
    .run('payments.charge', async () => {
      throw createStructuredError({
        message: 'Card declined',
        why: 'The payment processor rejected the card',
        fix: 'Ask the customer to try a different card',
        status: 402,
      });
    })
    .catch(next);
});

// An unexpected server error: the report store answers without rows, the
// handler throws, and the API answers 500.
app.get('/api/reports', () => {
  const report: { rows: unknown[] } = JSON.parse('{}');
  return report.rows.length;
});

app.get('/api/slow', async (_req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  res.json({ ok: true });
});

const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({ message: String(error?.message ?? error) });
};
app.use(errors);

const port = Number(process.env.API_PORT ?? 8082);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
