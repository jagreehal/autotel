import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';
import * as esbuild from 'esbuild';
import { createStructuredError, init, shutdown, trace } from 'autotel';
import { extractTraceContext } from 'autotel/http';
import { sentryOtlpConfig } from 'autotel-sentry';

const PORT = Number(process.env.PORT ?? 8788);
const dir = path.dirname(fileURLToPath(import.meta.url));
const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

// Sentry for errors, autotel for traces. @sentry/node 11 leaves OpenTelemetry
// alone by default (`enableOpenTelemetrySetup: false`).
Sentry.init({ dsn: config.dsn, environment: 'example' });
Sentry.setOpenTelemetryContextAsyncContextStrategy();
init({
  service: 'example-sentry-api',
  endpoint: config.endpoint,
  headers: config.headers,
});

const client = await esbuild.build({
  absWorkingDir: path.join(dir, '../..'),
  entryPoints: ['src/web/client.ts'],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'browser',
  define: {
    __SENTRY_DSN__: JSON.stringify(config.dsn),
    __SENTRY_ORG__: JSON.stringify(process.env.SENTRY_ORG ?? ''),
    'process.env.NODE_ENV': '"development"',
  },
});
const clientJs = client.outputFiles[0]?.text ?? '';

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>example-sentry (browser)</title>
    <style>
      body { font: 16px/1.4 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
      button { font: inherit; padding: 0.5rem 1rem; }
      pre { background: #111; color: #eee; padding: 1rem; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>Sentry join</h1>
    <p>Click checkout. The browser error in Sentry opens the trace; the trace holds the browser and server spans and links the replay.</p>
    <button id="checkout" type="button">Fail checkout</button>
    <pre id="out">Ready.</pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (req.method === 'GET' && req.url === '/client.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(clientJs);
    return;
  }
  if (req.method === 'POST' && req.url === '/checkout') {
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

server.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void Promise.all([shutdown(), Sentry.flush(2000)]).finally(() =>
      process.exit(0),
    );
  });
}
