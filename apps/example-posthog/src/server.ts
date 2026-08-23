import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from '@opentelemetry/api';
import * as esbuild from 'esbuild';
import { createStructuredError, init, shutdown, trace } from 'autotel';
import { extractTraceContext } from 'autotel/http';

const PORT = Number(process.env.PORT ?? 8787);
const dir = path.dirname(fileURLToPath(import.meta.url));

init({
  service: 'example-posthog',
  baggage: '',
  debug: 'pretty',
});

const client = await esbuild.build({
  absWorkingDir: path.join(dir, '..'),
  entryPoints: ['src/client.ts'],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'browser',
  define: {
    __POSTHOG_KEY__: JSON.stringify(process.env.POSTHOG_KEY ?? ''),
    __POSTHOG_HOST__: JSON.stringify(
      process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    ),
  },
});

console.log(
  process.env.POSTHOG_KEY
    ? `PostHog: live (${process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'})`
    : 'PostHog: stub (set POSTHOG_KEY in .env for a live project)',
);

const clientJs = client.outputFiles[0]?.text ?? '';

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>example-posthog</title>
    <style>
      body { font: 16px/1.4 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
      button { font: inherit; padding: 0.5rem 1rem; }
      pre { background: #111; color: #eee; padding: 1rem; overflow: auto; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>PostHog join</h1>
    <p>Click checkout. The span gets a replay URL. The PostHog event gets <code>$trace_id</code>. The server log prints <code>session.id</code> from baggage.</p>
    <button id="checkout" type="button">Fail checkout</button>
    <pre id="out">Ready.</pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

function headersOf(
  incoming: http.IncomingHttpHeaders,
): Record<string, string | string[] | undefined> {
  return incoming;
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';

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
    console.log(`baggage header: ${String(req.headers.baggage ?? '')}`);
    const extracted = extractTraceContext(headersOf(req.headers));
    void context.with(extracted, async () => {
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
        const message = cause instanceof Error ? cause.message : String(cause);
        console.log(`checkout failed: ${message}`);
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void shutdown().finally(() => process.exit(0));
  });
}
