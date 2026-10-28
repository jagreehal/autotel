import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { context } from '@opentelemetry/api';
import * as esbuild from 'esbuild';
import { createStructuredError, init, shutdown, trace } from 'autotel';
import { extractTraceContext } from 'autotel/http';
import {
  createDatadogConfig,
  type DatadogSite,
} from 'autotel-backends/datadog';
import { otlpRelay } from 'autotel-backends/relay';

const PORT = Number(process.env.PORT ?? 8790);
const dir = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.DATADOG_API_KEY ?? process.env.DD_API_KEY;
// SAFETY: a wrong site fails loudly at the first export; the preset documents
// the valid ones.
const site = (process.env.DATADOG_SITE ??
  process.env.DD_SITE ??
  'datadoghq.com') as DatadogSite;
const release = {
  version: process.env.VERSION ?? '1.0.0',
  environment: process.env.ENVIRONMENT ?? 'example',
};

if (!apiKey) {
  console.error('Set DATADOG_API_KEY (and DATADOG_SITE) in .env.');
  process.exit(1);
}

// The server's own spans.
init(
  createDatadogConfig({
    apiKey,
    site,
    service: 'example-datadog-api',
    ...release,
  }),
);

// The browser's spans: same intake, the key added here and never shipped.
const relay = otlpRelay(
  createDatadogConfig({ apiKey, site, service: 'relay' }),
);

const rum = {
  applicationId: process.env.DD_RUM_APPLICATION_ID ?? 'local',
  clientToken: process.env.DD_RUM_CLIENT_TOKEN ?? 'local',
  site,
  live: Boolean(
    process.env.DD_RUM_APPLICATION_ID && process.env.DD_RUM_CLIENT_TOKEN,
  ),
};

const client = await esbuild.build({
  absWorkingDir: path.join(dir, '../..'),
  entryPoints: ['src/web/client.ts'],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'browser',
  define: {
    __DD_RUM__: JSON.stringify(rum),
    __RELEASE__: JSON.stringify(release),
    'process.env.NODE_ENV': '"development"',
  },
});
const clientJs = client.outputFiles[0]?.text ?? '';

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>example-datadog (browser)</title>
    <style>
      body { font: 16px/1.4 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
      button { font: inherit; padding: 0.5rem 1rem; margin-right: 0.5rem; }
      pre { background: #111; color: #eee; padding: 1rem; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>Datadog join</h1>
    <p><b>Fail checkout</b>: a RUM error that carries the autotel trace. <b>Throw</b>: an uncaught error, as a RUM error and as a Datadog Error Tracking issue from the span.</p>
    <button id="checkout" type="button">Fail checkout</button>
    <button id="throw" type="button">Throw</button>
    <pre id="out">Ready.</pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

/** RUM events posted to /rum-intake when there is no RUM application. */
const rumEvents: unknown[] = [];

function toRequest(req: http.IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  // SAFETY: Node's web stream is the WHATWG ReadableStream fetch takes; the
  // Node and DOM typings name it differently.
  const body = hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined;
  // SAFETY: Node's fetch requires `duplex` for a streamed body, and the
  // RequestInit typings do not have it yet.
  const init = {
    method: req.method,
    headers,
    body,
    duplex: 'half',
  } as RequestInit;
  return new Request(`http://${req.headers.host}${req.url}`, init);
}

async function send(res: http.ServerResponse, response: Response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';

  if (url.startsWith('/otel/')) {
    await send(res, await relay(toRequest(req)));
    return;
  }
  if (req.method === 'POST' && url.startsWith('/rum-intake')) {
    // SAFETY: as in toRequest, Node's web stream is the WHATWG one.
    const stream = Readable.toWeb(req) as ReadableStream;
    const body = await new Response(stream).text();
    // RUM's proxy carries every track: events are newline-delimited JSON on
    // /api/v2/rum; replay segments arrive as multipart and are not kept.
    const forward =
      new URL(url, 'http://x').searchParams.get('ddforward') ?? '';
    if (forward.startsWith('/api/v2/rum')) {
      for (const line of body.split('\n')) {
        try {
          if (line.trim()) rumEvents.push(JSON.parse(line));
        } catch {
          // Not an event line.
        }
      }
    }
    res.writeHead(202);
    res.end();
    return;
  }
  if (req.method === 'GET' && url === '/rum-events') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rumEvents));
    return;
  }
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (req.method === 'GET' && url === '/client.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(clientJs);
    return;
  }
  if (req.method === 'POST' && url === '/checkout') {
    void context.with(extractTraceContext(req.headers), async () => {
      try {
        await trace.run('POST /checkout', () => {
          throw createStructuredError({
            message: 'Card declined',
            why: 'The payment processor rejected the card',
            fix: 'Ask the customer to try a different card',
            status: 402,
          });
        });
      } catch (cause) {
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(cause) }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`RUM: ${rum.live ? 'live' : 'local capture at /rum-events'}`);
  console.log(`Open http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void shutdown().finally(() => process.exit(0));
  });
}
