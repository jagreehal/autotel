// @vitest-environment jsdom
/**
 * `autotel-web/metrics`, exercised against a real OTLP/HTTP listener: what
 * leaves the page (path, temporality, resource) is the contract, so the tests
 * read it off the wire rather than off the SDK's internals.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { initFull, resetFullForTesting } from './full';
import {
  createCounter,
  createHistogram,
  createUpDownCounter,
  flushMetrics,
  initMetrics,
  resetMetricsForTesting,
  shutdownMetrics,
} from './metrics';
import { resetForTesting as resetExporter } from './span-exporter';
import { resetSessionForTesting } from './session';

/** One OTLP/JSON metrics request as the collector received it. */
interface Received {
  path: string;
  body: OtlpMetricsRequest;
}

/** The slice of the OTLP/JSON metrics payload these tests read. */
interface OtlpMetricsRequest {
  resourceMetrics: Array<{
    resource: {
      attributes: Array<{ key: string; value: { stringValue?: string } }>;
    };
    scopeMetrics: Array<{
      metrics: Array<{
        name: string;
        sum?: {
          aggregationTemporality: number;
          dataPoints: Array<{ asInt?: number; asDouble?: number }>;
        };
      }>;
    }>;
  }>;
}

/** OTLP's wire enum, not the SDK's: DELTA is 1 there (CUMULATIVE is 2). */
const OTLP_DELTA = 1;

let server: Server;
let endpoint: string;
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    request.on('end', () => {
      // SAFETY: the OTLP/HTTP JSON metric exporter is the only client of this
      // listener; the fields read are checked by the assertions that use them.
      received.push({
        path: request.url ?? '',
        body: JSON.parse(raw) as OtlpMetricsRequest,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // SAFETY: listen() on a TCP host always yields an AddressInfo.
  const { port } = server.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(async () => {
  await resetMetricsForTesting();
  resetFullForTesting();
  resetExporter();
  resetSessionForTesting();
  received.length = 0;
});

const attribute = (request: OtlpMetricsRequest, key: string) =>
  request.resourceMetrics[0]?.resource.attributes.find((a) => a.key === key)
    ?.value.stringValue;

function metricNamed(request: OtlpMetricsRequest, name: string) {
  return request.resourceMetrics
    .flatMap((r) => r.scopeMetrics)
    .flatMap((s) => s.metrics)
    .find((m) => m.name === name);
}

/** A reader that keeps what it exports, for tests that need no wire. */
function inMemoryReader() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const exported = () =>
    exporter
      .getMetrics()
      .flatMap((r) => r.scopeMetrics)
      .flatMap((s) => s.metrics)
      .map((m) => [m.descriptor.name, m.dataPoints.map((p) => p.value)]);
  return { reader, exported };
}

describe('initMetrics', () => {
  it('exports to /v1/metrics of the endpoint initFull was given, under its service', async () => {
    initFull({
      service: 'checkout-web',
      endpoint,
      version: '1.4.2',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
    });
    initMetrics();

    createCounter('app.checkout.completed').add(1, { plan: 'pro' });
    await flushMetrics();

    const [request] = received;
    expect(request?.path).toBe('/v1/metrics');
    expect(attribute(request!.body, 'service.name')).toBe('checkout-web');
    expect(attribute(request!.body, 'service.version')).toBe('1.4.2');
  });

  it("takes initFull's service and release even when only metrics get an endpoint", async () => {
    initFull({
      service: 'checkout-web',
      version: '1.4.2',
      environment: 'staging',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
    });
    initMetrics({ endpoint });

    createCounter('app.checkout.completed').add(1);
    await flushMetrics();

    const [request] = received;
    expect(attribute(request!.body, 'service.name')).toBe('checkout-web');
    expect(attribute(request!.body, 'service.version')).toBe('1.4.2');
    expect(attribute(request!.body, 'deployment.environment.name')).toBe(
      'staging',
    );
  });

  it('exports deltas, so tabs reporting under one resource add up', async () => {
    initMetrics({ service: 'web', endpoint });
    const counter = createCounter('app.clicks');

    counter.add(2);
    await flushMetrics();
    counter.add(3);
    await flushMetrics();

    const sums = received.map((r) => metricNamed(r.body, 'app.clicks')?.sum);
    expect(sums.map((s) => s?.aggregationTemporality)).toEqual([
      OTLP_DELTA,
      OTLP_DELTA,
    ]);
    expect(
      sums.map((s) => s?.dataPoints[0]?.asInt ?? s?.dataPoints[0]?.asDouble),
    ).toEqual([2, 3]);
  });

  it('never stamps session.id: one series per visit is not a metric', async () => {
    initMetrics({ service: 'web', endpoint });
    createCounter('app.clicks').add(1);
    await flushMetrics();

    const keys = received[0]!.body.resourceMetrics[0]!.resource.attributes.map(
      (a) => a.key,
    );
    expect(keys).not.toContain('session.id');
  });

  it('records into extra readers without any endpoint', async () => {
    const { reader, exported } = inMemoryReader();
    initMetrics({ service: 'web', metricReaders: [reader] });

    createUpDownCounter('app.cart.items').add(-1);
    createHistogram('app.render.duration').record(12);
    await flushMetrics();

    expect(exported()).toContainEqual(['app.cart.items', [-1]]);
    expect(received).toEqual([]);
  });
});

describe('instruments', () => {
  it('declared before initMetrics, still record once it has run', async () => {
    // Module-scope instruments are evaluated before the app's entry point
    // calls initMetrics(); with the plain API they would stay no-ops forever.
    const early = createCounter('app.early');
    early.add(5); // before init: dropped, by design

    const { reader, exported } = inMemoryReader();
    initMetrics({ service: 'web', metricReaders: [reader] });
    early.add(1);
    await flushMetrics();

    expect(exported()).toEqual([['app.early', [1]]]);
  });

  it('follow a provider replaced by shutdown and a second init', async () => {
    const counter = createCounter('app.reinit');
    initMetrics({ service: 'web', metricReaders: [inMemoryReader().reader] });
    counter.add(1);
    await shutdownMetrics();
    counter.add(100); // no provider: a no-op, not a throw

    const second = inMemoryReader();
    initMetrics({ service: 'web', metricReaders: [second.reader] });
    counter.add(2);
    await flushMetrics();

    expect(second.exported()).toEqual([['app.reinit', [2]]]);
  });
});

describe('page hide', () => {
  it('flushes what is pending, since the interval will not fire again', async () => {
    initMetrics({ service: 'web', endpoint, exportIntervalMs: 60_000 });
    createCounter('app.clicks').add(1);

    const visibility = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'visibilityState',
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      document.dispatchEvent(new Event('visibilitychange'));

      await expect.poll(() => received.length).toBe(1);
      expect(received[0]?.path).toBe('/v1/metrics');
    } finally {
      // Back to the prototype's getter for the tests after this one.
      if (visibility)
        Object.defineProperty(document, 'visibilityState', visibility);
    }
  });
});
