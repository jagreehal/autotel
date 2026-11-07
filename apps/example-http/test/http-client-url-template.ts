import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { init } from '../../../packages/autotel/src/init';
import { createMemoryExporter } from '../../../packages/autotel/src/memory-exporter';
import { flush, shutdown } from '../../../packages/autotel/src/shutdown';

const exporter = createMemoryExporter();
init({
  service: 'http-client-url-template-integration',
  devtools: false,
  sampling: 'development',
  spanExporter: exporter,
  metrics: false,
  logs: false,
  autoInstrumentations: ['http', 'undici'],
  httpClientUrlTemplate: (url) =>
    url.pathname.startsWith('/orders/') ? '/orders/{id}' : undefined,
});

// Load node:http after init so OTel can patch it.
const require = createRequire(import.meta.url);
const http: typeof import('node:http') = require('node:http');

const server = http.createServer((_req, res) => res.end('ok'));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
// SAFETY: listening on a TCP port has completed, so address() is AddressInfo.
const address = server.address() as AddressInfo;
const origin = `http://127.0.0.1:${address.port}`;

function get(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    http
      .get(`${origin}${path}`, (response) => {
        response.resume();
        response.on('end', resolve);
      })
      .on('error', reject);
  });
}

try {
  await get('/orders/ord_1');
  await (await fetch(`${origin}/orders/ord_2`)).text();
  await get('/health');
  await flush();

  const named = exporter.findSpans('GET /orders/{id}');
  assert.equal(named.length, 2, 'http and fetch client spans are named');
  for (const span of named) {
    assert.equal(span.attributes['url.template'], '/orders/{id}');
  }
  const health = exporter
    .spans()
    .filter((span) => span.attributes['url.full'] === `${origin}/health`);
  assert.equal(health.length, 1);
  assert.equal(health[0]?.name, 'GET', 'an unmatched path keeps its name');
  assert.equal(health[0]?.attributes['url.template'], undefined);
} finally {
  server.close();
  await shutdown();
}
