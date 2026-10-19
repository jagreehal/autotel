import { afterEach, describe, expect, it, vi } from 'vitest';
import { context, trace as otelTrace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

/**
 * `spanProcessors` replaces the pipeline autotel builds, tail sampling
 * included, so a caller can keep an unsampled branch (an audit trail) beside a
 * sampled one. The cost of that escape hatch is that `sampling: 'production'`
 * with a plain processor drops nothing. init() has to say so, once, instead of
 * letting the bill be the only signal.
 */
const WARNING = 'none of your spanProcessors is wrapped';

/**
 * A fresh autotel per test: init() and its tracer are module singletons, so a
 * static import would keep the first test's provider for every later one.
 */
/* eslint-disable eslint-js/no-restricted-syntax */
async function load() {
  vi.resetModules();
  otelTrace.disable();
  return {
    ...(await import('./init')),
    ...(await import('./functional')),
    ...(await import('./shutdown')),
    ...(await import('./filtering-span-processor')),
    ...(await import('./tail-sampling-processor')),
  };
}
/* eslint-enable eslint-js/no-restricted-syntax */

describe('a tail sampler with custom spanProcessors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const warnings = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls.filter(([msg]: unknown[]) => String(msg).includes(WARNING));

  it('warns once when no processor is tail-sampling wrapped, and keeps every span', async () => {
    const { init, trace, shutdown } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exporter = new InMemorySpanExporter();
    init({
      service: 'unwrapped',
      sampling: 'production',
      spanProcessors: [
        new SimpleSpanProcessor(exporter),
        new SimpleSpanProcessor(new InMemorySpanExporter()),
      ],
    });

    const work = trace('work', async () => 1);
    for (let i = 0; i < 50; i++) await work();

    expect(warnings(warn)).toHaveLength(1);
    await expect.poll(() => exporter.getFinishedSpans().length).toBe(50);
    await shutdown();
  });

  it('drops on the wrapped branch and stays quiet when one is wrapped, however deep', async () => {
    const {
      init,
      trace,
      shutdown,
      FilteringSpanProcessor,
      TailSamplingSpanProcessor,
    } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audit = new InMemorySpanExporter();
    const ops = new InMemorySpanExporter();
    init({
      service: 'wrapped',
      sampling: 'production',
      spanProcessors: [
        new SimpleSpanProcessor(audit),
        new FilteringSpanProcessor(
          new TailSamplingSpanProcessor(new SimpleSpanProcessor(ops)),
          { filter: () => true },
        ),
      ],
    });

    const work = trace('work', async () => 1);
    for (let i = 0; i < 200; i++) await work();

    expect(warnings(warn)).toHaveLength(0);
    await expect.poll(() => audit.getFinishedSpans().length).toBe(200);
    const kept = ops.getFinishedSpans().length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(100);
    await shutdown();
  });

  it('stays quiet for a sampler that never drops at span end', async () => {
    const { init, shutdown } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    init({
      service: 'dev',
      sampling: 'development',
      spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
    });

    expect(warnings(warn)).toHaveLength(0);
    await shutdown();
  });

  it('wraps spanExporters itself, so they need no warning and are sampled', async () => {
    const { init, trace, flush, shutdown } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exporter = new InMemorySpanExporter();
    init({
      service: 'exporters',
      sampling: 'production',
      spanExporters: [exporter],
    });

    const work = trace('work', async () => 1);
    for (let i = 0; i < 200; i++) await work();
    await flush();

    expect(warnings(warn)).toHaveLength(0);
    const kept = exporter.getFinishedSpans().length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(100);
    await shutdown();
  });
});

describe('sampling applies to whole traces, auto-instrumented ones included', () => {
  it('drops sampled-out auto-instrumented roots and the children of dropped traces', async () => {
    const { init, trace, flush, shutdown } = await load();
    const exporter = new InMemorySpanExporter();
    init({
      service: 'auto-spans',
      sampling: 'errors-only',
      spanExporters: [exporter],
      spanFilter: (s) => !s.name.includes('/health'),
    });
    // A tracer no autotel wrapper touches, as an instrumentation would use.
    const tracer = otelTrace.getTracer('auto');
    for (let i = 0; i < 10; i++) tracer.startSpan('GET /orders').end();
    for (let i = 0; i < 10; i++) tracer.startSpan('GET /health').end();
    const work = trace('work', async () => {
      tracer.startSpan('db.query').end();
    });
    for (let i = 0; i < 10; i++) await work();
    const failing = tracer.startSpan('GET /fail');
    failing.setStatus({ code: 2 });
    failing.end();

    await flush();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual([
      'GET /fail',
    ]);
    await shutdown();
  });

  it('keeps every trace when no sampling is configured', async () => {
    const { init, flush, shutdown } = await load();
    const exporter = new InMemorySpanExporter();
    init({ service: 'unsampled', spanExporters: [exporter] });
    const tracer = otelTrace.getTracer('auto');
    for (let i = 0; i < 10; i++) tracer.startSpan('GET /orders').end();

    await flush();
    expect(exporter.getFinishedSpans()).toHaveLength(10);
    await shutdown();
  });

  it('spanFilter drops a filtered root with its trace and re-parents past a filtered middle span', async () => {
    const { init, flush, shutdown } = await load();
    const exporter = new InMemorySpanExporter();
    init({
      service: 'filtered',
      spanExporters: [exporter],
      spanFilter: (s) => !s.name.includes('/health') && s.name !== 'fs.read',
    });
    const tracer = otelTrace.getTracer('auto');
    const childOf = (
      name: string,
      parent: ReturnType<typeof tracer.startSpan>,
    ) =>
      tracer.startSpan(name, {}, otelTrace.setSpan(context.active(), parent));

    const health = tracer.startSpan('GET /health');
    childOf('db.ping', health).end();
    health.end();

    const root = tracer.startSpan('GET /orders');
    const fsRead = childOf('fs.read', root);
    childOf('db.query', fsRead).end();
    fsRead.end();
    root.end();

    await flush();
    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.name)).toEqual(['db.query', 'GET /orders']);
    expect(spans[0]?.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    await shutdown();
  });

  it('gives a TailSamplingSpanProcessor in custom spanProcessors the init sampler', async () => {
    const { init, flush, shutdown, TailSamplingSpanProcessor } = await load();
    const exporter = new InMemorySpanExporter();
    init({
      service: 'custom-tail',
      sampling: 'errors-only',
      spanProcessors: [
        new TailSamplingSpanProcessor(new SimpleSpanProcessor(exporter)),
      ],
    });
    const tracer = otelTrace.getTracer('auto');
    for (let i = 0; i < 10; i++) tracer.startSpan('GET /orders').end();

    await flush();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    await shutdown();
  });
});
