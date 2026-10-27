import {
  context,
  createContextKey,
  trace as otelTrace,
} from '@opentelemetry/api';
import { beforeEach, describe, expect, it } from 'vitest';
import { ctx, requestCtx, span, trace } from './functional';
import { init } from './init';
import { createTraceCollector } from './testing';

/**
 * The key `@opentelemetry/core` publishes RPC metadata under. `createContextKey`
 * is `Symbol.for`, so this is the very symbol `instrumentation-http` writes when
 * it opens a server span - this suite stands in for it without pulling the
 * instrumentation into a unit test.
 */
const RPC_METADATA_KEY = createContextKey(
  'OpenTelemetry SDK Context Key RPC_METADATA',
);

/**
 * Run `fn` as a framework layer runs: inside a request span, with that span
 * published as RPC metadata the way `instrumentation-http` publishes it.
 */
function withRequestSpan(name: string, fn: () => void): void {
  span({ name }, () => {
    const requestSpan = otelTrace.getActiveSpan();
    const active = context
      .active()
      .setValue(RPC_METADATA_KEY, { type: 'http', span: requestSpan });
    context.with(active, fn);
  });
}

describe('requestCtx', () => {
  beforeEach(() => {
    init({ service: 'test-service' });
  });

  it('writes to the request span, not the layer span it is called from', () => {
    const collector = createTraceCollector();

    withRequestSpan('GET /users/:id', () => {
      // What instrumentation-express runs a `router.use` under.
      span({ name: 'middleware - setTraceAttributes' }, () => {
        requestCtx.setAttribute('user.id', 'u_1');
        ctx.setAttribute('layer.saw.it', true);
      });
    });

    const spans = collector.getSpans();
    const request = spans.find((s) => s.name === 'GET /users/:id');
    const layer = spans.find(
      (s) => s.name === 'middleware - setTraceAttributes',
    );

    expect(request).toBeDefined();
    expect(layer).toBeDefined();
    expect(request?.attributes['user.id']).toBe('u_1');
    expect(layer?.attributes['user.id']).toBeUndefined();
    // ctx keeps pointing at the span the code is actually in.
    expect(layer?.attributes['layer.saw.it']).toBe(true);
    expect(request?.attributes['layer.saw.it']).toBeUndefined();
  });

  it('flattens rich values onto the request span', () => {
    const collector = createTraceCollector();

    withRequestSpan('GET /rights', () => {
      span({ name: 'middleware - auth' }, () => {
        requestCtx.setAttributes({
          'client-rights': { admin: true, reports: { view: true } },
        });
      });
    });

    const request = collector.getSpans().find((s) => s.name === 'GET /rights');
    expect(request).toBeDefined();
    expect(request?.attributes['client-rights.admin']).toBe(true);
    expect(request?.attributes['client-rights.reports.view']).toBe(true);
  });

  it('reports the request span identity', () => {
    let seen: { traceId?: string; spanId?: string } = {};
    let layerSpanId: string | undefined;

    withRequestSpan('GET /ids', () => {
      const requestSpanId = otelTrace.getActiveSpan()?.spanContext().spanId;
      span({ name: 'middleware - ids' }, () => {
        layerSpanId = otelTrace.getActiveSpan()?.spanContext().spanId;
        seen = { traceId: requestCtx.traceId, spanId: requestCtx.spanId };
      });
      expect(seen.spanId).toBe(requestSpanId);
    });

    expect(seen.spanId).not.toBe(layerSpanId);
    expect(seen.traceId).toHaveLength(32);
  });

  it('falls back to the active span outside a request', async () => {
    const collector = createTraceCollector();

    // A queue consumer or cron job has no request span; the attribute belongs
    // somewhere real rather than nowhere.
    const consume = trace(async function consume() {
      requestCtx.setAttribute('job.id', 'j_1');
    });
    await consume();

    const spans = collector.getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes['job.id']).toBe('j_1');
  });

  it('writes to the job span a trace() root started, from a nested step', async () => {
    const collector = createTraceCollector();

    // A batch job: no request span, and the helper that knows the row count
    // runs two spans deep.
    await trace.run('job', async () => {
      await trace.run('job.ingest', async () => {
        await trace.run('job.ingest.parse', async () => {
          requestCtx.setAttribute('file.lines', 120);
        });
      });
    });

    const byName = Object.fromEntries(
      collector.getSpans().map((s) => [s.name, s.attributes]),
    );
    expect(byName['job']?.['file.lines']).toBe(120);
    expect(byName['job.ingest.parse']?.['file.lines']).toBeUndefined();
  });

  it('skips a null or undefined link, so createLinkFromHeaders() passes straight in', async () => {
    const collector = createTraceCollector();
    const link = {
      context: {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      },
    };

    await trace.run('linked', async (ctx) => {
      expect(() => ctx.addLink(null)).not.toThrow();
      ctx.addLink(undefined);
      ctx.addLinks([null, link, undefined]);
    });

    expect(collector.getSpans()[0]?.links).toEqual([link]);
  });

  it('no-ops when nothing is active', () => {
    expect(() => requestCtx.setAttribute('user.id', 'u_1')).not.toThrow();
    expect(requestCtx.traceId).toBeUndefined();
    expect(requestCtx.isRecording()).toBe(false);
  });
});
