/**
 * Findings 4.1: on autotel 7.x, sampling judged only spans its own wrappers
 * made, so every HTTP server span was exported and ~99% of the controller
 * spans under them were dropped. Now a trace is kept or dropped whole: no
 * server span without its controller span, and no controller span alone.
 *
 * Run: pnpm --filter @jagreehal/example-http exec tsx test/whole-trace-sampling.ts
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { init } from '../../../packages/autotel/src/init';
import { instrument } from '../../../packages/autotel/src/functional';
import { createMemoryExporter } from '../../../packages/autotel/src/memory-exporter';
import { flush, shutdown } from '../../../packages/autotel/src/shutdown';

const exporter = createMemoryExporter();
init({
  service: 'whole-trace-sampling',
  devtools: false,
  sampling: 'production', // 10% baseline, plus errors and slow traces
  spanExporter: exporter,
  metrics: false,
  logs: false,
  autoInstrumentations: ['http', 'express'],
});

const require = createRequire(import.meta.url);
const express: typeof import('express') = require('express');

const getPossibleClients = instrument({
  key: 'controller.getPossibleClients',
  fn: async (userId: string) => [{ userId }],
});

const app = express();
app.get('/users/:id/get_possible_clients', async (req, res) => {
  res.json(await getPossibleClients(req.params.id));
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
// SAFETY: listening on a TCP port has completed, so address() is AddressInfo.
const { port } = server.address() as AddressInfo;

try {
  for (let i = 0; i < 200; i++) {
    const res = await fetch(
      `http://127.0.0.1:${port}/users/67100478766128ccd2b8ee3${i % 10}/get_possible_clients`,
    );
    await res.text();
  }
  await flush();

  const traces = new Map<string, string[]>();
  for (const span of exporter.spans()) {
    const names = traces.get(span.traceId) ?? [];
    names.push(span.name);
    traces.set(span.traceId, names);
  }
  const incomplete = [...traces.values()].filter(
    (names) =>
      names.includes('controller.getPossibleClients') !==
      names.includes('GET /users/:id/get_possible_clients'),
  );
  assert.ok(traces.size > 0 && traces.size < 200, `kept ${traces.size}/200`);
  assert.deepEqual(incomplete, [], 'every kept trace is whole');
  console.log(`ok: kept ${traces.size}/200 traces, all complete`);
} finally {
  server.close();
  await shutdown();
}
