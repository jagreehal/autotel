// Runs server.ts under a real PM2 daemon and asserts both destinations got data.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { toPm2Span } from './pm2-span-exporter';

// A private daemon: PM2 reads PM2_HOME when it loads, so set it first.
const home = mkdtempSync(join(tmpdir(), 'autotel-pm2-'));
process.env.PM2_HOME = home;
const pm2 = createRequire(import.meta.url)('pm2');

type OtlpSpan = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
};
const otlpSpans: OtlpSpan[] = [];
const sink = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    for (const resource of body.resourceSpans ?? [])
      for (const scope of resource.scopeSpans) otlpSpans.push(...scope.spans);
    response.end('{}');
  });
});
await new Promise<void>((resolve) => sink.listen(0, resolve));

// Cases a request can't reach. A span here is only the fields toPm2Span reads.
const fakeSpan = (fields: object) =>
  ({
    spanContext: () => ({ traceId: 't', spanId: 's' }),
    startTime: [0, 0],
    duration: [0, 0],
    attributes: {},
    events: [],
    resource: { attributes: {} },
    status: { code: 0 },
    ...fields,
  }) as unknown as ReadableSpan;

assert.deepEqual(
  toPm2Span(
    fakeSpan({
      attributes: { error: 'kept' },
      status: { code: 1, message: 'ignored' },
      droppedAttributesCount: 2,
      droppedEventsCount: 3,
      droppedLinksCount: 0,
    }),
  ).tags,
  {
    error: 'kept',
    'otel.status_code': 'OK',
    'otel.dropped_attributes_count': '2',
    'otel.dropped_events_count': '3',
  },
);
assert.equal(toPm2Span(fakeSpan({})).annotations, undefined);

const bus: Record<string, any[]> = {};
const until = async (what: string, ok: () => unknown) => {
  for (let i = 0; i < 200; i++) {
    const value = ok();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const port = 3456;
try {
  await promisify(pm2.connect.bind(pm2))();
  const events = await promisify(pm2.launchBus.bind(pm2))();
  events.on('*', (event: string, packet: unknown) =>
    (bus[event] ??= []).push(packet),
  );

  await promisify(pm2.start.bind(pm2))({
    name: 'example-pm2',
    script: 'src/server.ts',
    interpreter: 'node',
    node_args: ['--import', 'tsx'],
    env: {
      PORT: String(port),
      OTLP_ENDPOINT: `http://127.0.0.1:${(sink.address() as AddressInfo).port}`,
    },
  });

  let answered = false;
  for (let i = 0; i < 100 && !answered; i++) {
    answered = await fetch(`http://127.0.0.1:${port}/`).then(
      (r) => r.ok,
      () => false,
    );
    if (!answered) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(answered, 'server never answered');

  await until('OTLP spans', () => otlpSpans.some((s) => s.name === 'charge'));
  const charge = otlpSpans.find((s) => s.name === 'charge')!;
  const parent = otlpSpans.find((s) => s.spanId === charge.parentSpanId);
  assert.equal(parent?.name, 'checkout');
  await until('PM2 spans', () =>
    bus['trace-span']?.some((p) => p.data.id === charge.spanId),
  );
  const pm2Charge = bus['trace-span']!.find(
    (p) => p.data.id === charge.spanId,
  ).data;
  assert.equal(pm2Charge.traceId, charge.traceId);
  assert.equal(pm2Charge.parentId, charge.parentSpanId);

  const failed = await fetch(`http://127.0.0.1:${port}/fail`);
  assert.equal(failed.status, 500);
  await until('failed PM2 span', () =>
    bus['trace-span']?.some((p) => p.data.name === 'declined'),
  );
  const { tags, annotations } = bus['trace-span']!.find(
    (p) => p.data.name === 'declined',
  ).data;
  assert.equal(tags['otel.status_code'], 'ERROR');
  assert.equal(tags.error, 'card declined');
  assert.equal(tags['service.name'], 'example-pm2');
  assert.ok(
    annotations.some((a: { value: string }) => a.value === 'exception'),
  );

  // PM2 keeps metrics on the process, not on the bus.
  const describe = promisify(pm2.describe.bind(pm2));
  let pmId = -1;
  for (let i = 0; i < 100 && pmId < 0; i++) {
    const [{ pm2_env }] = await describe('example-pm2');
    if (pm2_env.axm_monitor?.orders?.value >= 1) pmId = pm2_env.pm_id;
    else await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(pmId >= 0, 'orders metric never reached PM2');

  await promisify(pm2.trigger.bind(pm2))(pmId, 'orders:count');
  await until('action reply', () =>
    bus['axm:reply']?.some((p) => p.data.return?.orders >= 1),
  );

  console.log(
    `OTLP: ${otlpSpans.length} spans, charge -> checkout in trace ${charge.traceId}`,
  );
  console.log(
    `PM2:  ${bus['trace-span']!.length} trace-span messages, same trace and parent`,
  );
  console.log('PM2:  orders metric reported, orders:count action answered');
} finally {
  await promisify(pm2.delete.bind(pm2))('all').catch(() => {});
  await promisify(pm2.killDaemon.bind(pm2))().catch(() => {});
  pm2.disconnect();
  sink.close();
  rmSync(home, { recursive: true, force: true });
}
process.exit(0);
