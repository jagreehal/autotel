/**
 * Findings 5.4: a sampler that drops a span whose parent is exported loses
 * data quietly, because the trace still shows up. In development autotel now
 * warns once. Here a controller carries its own tail sampler (trace-level
 * sampling is off), so it is dropped under an exported HTTP server span.
 *
 * Run: pnpm --filter @jagreehal/example-http exec tsx test/incomplete-trace-warning.ts
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { init } from '../../../packages/autotel/src/init';
import { instrument } from '../../../packages/autotel/src/functional';
import { AdaptiveSampler } from '../../../packages/autotel/src/sampling';
import { createMemoryExporter } from '../../../packages/autotel/src/memory-exporter';
import { flush, shutdown } from '../../../packages/autotel/src/shutdown';

const warnings: string[] = [];
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(' '));
};

const exporter = createMemoryExporter();
init({
  service: 'incomplete-trace-warning',
  devtools: false,
  spanExporter: exporter,
  metrics: false,
  logs: false,
  autoInstrumentations: ['http'],
});

const require = createRequire(import.meta.url);
const http: typeof import('node:http') = require('node:http');

const controller = instrument({
  key: 'controller.getPossibleClients',
  sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
  fn: async () => 'ok',
});

const server = http.createServer(async (_req, res) =>
  res.end(await controller()),
);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
// SAFETY: listening on a TCP port has completed, so address() is AddressInfo.
const { port } = server.address() as AddressInfo;

try {
  for (let i = 0; i < 3; i++) {
    await (await fetch(`http://127.0.0.1:${port}/x`)).text();
  }
  await flush();
  const names = exporter.spans().map((span) => span.name);
  assert.ok(names.includes('GET'), 'server spans exported');
  assert.ok(
    !names.includes('controller.getPossibleClients'),
    'controller dropped',
  );
  const incomplete = warnings.filter((w) => w.includes('trace is incomplete'));
  assert.equal(incomplete.length, 1, warnings.join('\n'));
  console.log('ok: warned once —', incomplete[0]);
} finally {
  console.warn = warn;
  server.close();
  await shutdown();
}
