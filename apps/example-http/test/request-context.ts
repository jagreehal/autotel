import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import { init } from '../../../packages/autotel/src/init';
import { requestCtx, trace } from '../../../packages/autotel/src/functional';
import { createMemoryExporter } from '../../../packages/autotel/src/memory-exporter';
import { flush, shutdown } from '../../../packages/autotel/src/shutdown';

const exporter = createMemoryExporter();
const layers = process.argv[2] === 'layers';
init({
  service: 'request-context-integration',
  devtools: false,
  sampling: 'development',
  spanExporter: exporter,
  metrics: false,
  logs: false,
  autoInstrumentations: layers
    ? { http: { enabled: true }, express: { ignoreLayersType: [] } }
    : ['http', 'express'],
});

// Load the actual modules after init so OTel can patch their exports.
const require = createRequire(import.meta.url);
const express: typeof import('express') = require('express');
const http: typeof import('node:http') = require('node:http');
const app = express();
const receivedBaggage: Array<string | undefined> = [];

app.use('/users', function identifyUser(req, _res, next) {
  requestCtx.setAttributes({ user: { id: req.get('x-test-user') } });
  next();
});
app.get('/downstream', (req, res) => {
  receivedBaggage.push(req.get('baggage'));
  res.end('ok');
});
app.get(
  '/users/:id',
  trace('users.handler', async (_req: Request, res: Response) => {
    await new Promise<void>((resolve, reject) => {
      http
        .get(`${origin}/downstream`, (response) => {
          response.resume();
          response.on('end', resolve);
          response.on('error', reject);
        })
        .on('error', reject);
    });
    res.end('ok');
  }),
);

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
// SAFETY: listening on a TCP port has completed, so address() is AddressInfo.
const address = server.address() as AddressInfo;
const origin = `http://127.0.0.1:${address.port}`;

try {
  await Promise.all(
    ['u_1', 'u_2'].map(async (user) => {
      const response = await fetch(`${origin}/users/${user}`, {
        headers: { 'x-test-user': user },
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'ok');
    }),
  );
  await flush();

  const requests = exporter.findSpans('GET /users/:id');
  assert.equal(
    requests.length,
    2,
    'HTTP server spans must be renamed by Express',
  );
  for (const user of ['u_1', 'u_2']) {
    const request = requests.find((s) => s.attributes['user.id'] === user);
    assert(request, `request span for ${user}`);
    const handler = exporter
      .findSpans('users.handler')
      .find((s) => s.traceId === request.traceId);
    assert(handler, 'traced handler must join the HTTP request');
    assert.equal(handler.attributes['user.id'], user);
    const outgoing = exporter
      .spans()
      .find((s) => s.parentSpanId === handler.spanId && s.name === 'GET');
    assert(outgoing, 'node:http must create an outgoing client span');
    assert.equal(outgoing.attributes['user.id'], user);
    const downstream = exporter
      .findSpans('GET /downstream')
      .find((s) => s.parentSpanId === outgoing.spanId);
    assert(downstream, 'traceparent must reach the downstream server');
    assert.equal(downstream.attributes['user.id'], undefined);
  }
  assert.deepEqual(receivedBaggage, [undefined, undefined]);
  const middleware = exporter.findSpans('middleware - identifyUser');
  assert.equal(middleware.length, layers ? 2 : 0);
  for (const span of middleware)
    assert.equal(span.attributes['user.id'], undefined);
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await shutdown();
}
