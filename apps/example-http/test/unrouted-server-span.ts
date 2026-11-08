/**
 * Findings 5.3: a request rejected before Express matched a route (a 401 from
 * auth middleware) was named just `GET`. It is now named from its path with
 * ids replaced, carries `url.template`, and leaves `http.route` unset. A
 * matched route still names the span.
 *
 * Run: pnpm --filter @jagreehal/example-http exec tsx test/unrouted-server-span.ts
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { init } from '../../../packages/autotel/src/init';
import { createMemoryExporter } from '../../../packages/autotel/src/memory-exporter';
import { flush, shutdown } from '../../../packages/autotel/src/shutdown';

const exporter = createMemoryExporter();
init({
  service: 'unrouted-server-span',
  devtools: false,
  sampling: 'development',
  spanExporter: exporter,
  metrics: false,
  logs: false,
  autoInstrumentations: ['http', 'express'],
});

// Load after init so OTel can patch them.
const require = createRequire(import.meta.url);
const express: typeof import('express') = require('express');

const app = express();
app.use((req, res, next) => {
  if (req.headers.authorization) return next();
  res.status(401).end();
});
app.get('/users/:id/get_possible_clients', (_req, res) => {
  res.json([]);
});

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
// SAFETY: listening on a TCP port has completed, so address() is AddressInfo.
const { port } = server.address() as AddressInfo;
const origin = `http://127.0.0.1:${port}`;
const objectId = '67100478766128ccd2b8ee31';

try {
  const rejected = await fetch(
    `${origin}/users/${objectId}/get_possible_clients?x=1`,
  );
  assert.equal(rejected.status, 401);
  const allowed = await fetch(
    `${origin}/users/${objectId}/get_possible_clients`,
    {
      headers: { authorization: 'Bearer t' },
    },
  );
  assert.equal(allowed.status, 200);
  const missing = await fetch(`${origin}/nope/123`, {
    headers: { authorization: 'Bearer t' },
  });
  assert.equal(missing.status, 404);
  await flush();

  // Express's own spans carry no status code; the server spans do.
  const servers = exporter.spans();
  const byStatus = (status: number) =>
    servers.find(
      (span) => span.attributes['http.response.status_code'] === status,
    );

  const unrouted = byStatus(401);
  assert.equal(unrouted?.name, 'GET /users/:id/get_possible_clients');
  assert.equal(
    unrouted?.attributes['url.template'],
    '/users/:id/get_possible_clients',
  );
  assert.equal(unrouted?.attributes['http.route'], undefined);

  const routed = byStatus(200);
  assert.equal(routed?.name, 'GET /users/:id/get_possible_clients');
  assert.equal(
    routed?.attributes['http.route'],
    '/users/:id/get_possible_clients',
  );
  assert.equal(routed?.attributes['url.template'], undefined);

  assert.equal(byStatus(404)?.name, 'GET', 'a 404 names no endpoint');
  console.log('ok: unrouted 401 named', unrouted?.name);
} finally {
  server.close();
  await shutdown();
}
