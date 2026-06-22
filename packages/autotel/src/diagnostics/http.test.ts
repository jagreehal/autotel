import { channel } from 'node:diagnostics_channel';
import {
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { instrumentHttp } from './http.js';

// Minimal W3C traceparent propagator so extract/inject have something to do
// (the real one lives in @opentelemetry/core, which isn't a direct dep here).
const w3c = {
  fields: () => ['traceparent'],
  inject(ctx: Context, carrier: unknown, setter: TextMapSetter) {
    const sc = trace.getSpanContext(ctx);
    if (!sc) return;
    setter.set(
      carrier,
      'traceparent',
      `00-${sc.traceId}-${sc.spanId}-0${sc.traceFlags}`,
    );
  },
  extract(ctx: Context, carrier: unknown, getter: TextMapGetter): Context {
    const raw = getter.get(carrier, 'traceparent');
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return ctx;
    const [, traceId, spanId, flags] = value.split('-');
    return trace.setSpanContext(ctx, {
      traceId: traceId!,
      spanId: spanId!,
      traceFlags: Number.parseInt(flags!, 16),
      isRemote: true,
    });
  },
};
propagation.setGlobalPropagator(w3c);

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const tracer = provider.getTracer('http-test');

let dispose: () => void = () => {};

beforeEach(() => {
  exporter.reset();
  dispose();
  dispose = () => {};
});

afterAll(async () => {
  dispose();
  await provider.shutdown();
});

const span = (kind: SpanKind): ReadableSpan =>
  exporter.getFinishedSpans().find((s) => s.kind === kind)!;

describe('instrumentHttp — server', () => {
  it('creates a SERVER span parented to the incoming traceparent with HTTP attrs', () => {
    dispose = instrumentHttp({ tracer, client: false });

    const request = {
      method: 'GET',
      url: '/orders?id=7',
      httpVersion: '1.1',
      headers: {
        host: 'api.example.com:8080',
        'user-agent': 'curl/8',
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      },
    };
    channel('http.server.request.start').publish({ request });
    channel('http.server.response.finish').publish({
      request,
      response: { statusCode: 200 },
    });

    const s = span(SpanKind.SERVER);
    expect(s.name).toBe('GET');
    expect(s.spanContext().traceId).toBe('11111111111111111111111111111111');
    expect(s.attributes['http.request.method']).toBe('GET');
    expect(s.attributes['url.path']).toBe('/orders');
    expect(s.attributes['server.address']).toBe('api.example.com');
    expect(s.attributes['server.port']).toBe(8080);
    expect(s.attributes['http.response.status_code']).toBe(200);
  });

  it('marks 5xx server responses as errors', () => {
    dispose = instrumentHttp({ tracer, client: false });
    const request = {
      method: 'POST',
      url: '/x',
      httpVersion: '1.1',
      headers: {},
    };
    channel('http.server.request.start').publish({ request });
    channel('http.server.response.finish').publish({
      request,
      response: { statusCode: 503 },
    });
    expect(span(SpanKind.SERVER).status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('instrumentHttp — client', () => {
  it('creates a CLIENT span and injects traceparent into outbound headers', () => {
    dispose = instrumentHttp({ tracer, server: false });

    const setHeaders: Record<string, string> = {};
    const request = {
      method: 'GET',
      host: 'downstream:9000',
      protocol: 'http:',
      path: '/v1/ping',
      headersSent: false,
      setHeader: (k: string, v: string) => {
        setHeaders[k] = v;
      },
    };
    channel('http.client.request.start').publish({ request });
    channel('http.client.response.finish').publish({
      request,
      response: { statusCode: 200 },
    });

    const s = span(SpanKind.CLIENT);
    expect(s.name).toBe('GET');
    expect(s.attributes['server.address']).toBe('downstream');
    expect(s.attributes['server.port']).toBe(9000);
    expect(s.attributes['url.full']).toBe('http://downstream:9000/v1/ping');
    // Injected its own span context for downstream propagation.
    expect(setHeaders.traceparent).toContain(s.spanContext().traceId);
  });

  it('records an error on client request error', () => {
    dispose = instrumentHttp({ tracer, server: false });
    const request = {
      method: 'GET',
      host: 'down:1',
      protocol: 'http:',
      path: '/',
      headersSent: true,
      setHeader: () => {},
    };
    channel('http.client.request.start').publish({ request });
    channel('http.client.request.error').publish({
      request,
      error: new Error('ECONNREFUSED'),
    });
    const s = span(SpanKind.CLIENT);
    expect(s.status.code).toBe(SpanStatusCode.ERROR);
    expect(s.status.message).toBe('ECONNREFUSED');
  });
});
