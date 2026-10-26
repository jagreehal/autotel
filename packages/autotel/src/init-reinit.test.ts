/**
 * OpenTelemetry's globals accept one registration each, so a pipeline started
 * after another (a second init(), or init() after shutdown()) has to release
 * them first, and every tracer handed out has to follow the new provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { propagation, type TextMapPropagator } from '@opentelemetry/api';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { init, getTracer, flush, shutdown, trace } from './index';
import { configure, getConfig, resetConfig } from './config';

function recordSpan(): void {
  getTracer('reinit').startSpan('work').end();
}

describe('init() after another pipeline', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    resetConfig();
    await shutdown();
  });

  it('a second init() replaces the first pipeline, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = new InMemorySpanExporter();
    const second = new InMemorySpanExporter();

    init({ service: 'first', spanExporters: [first] });
    init({ service: 'second', spanExporters: [second] });
    recordSpan();
    await flush();

    expect(second.getFinishedSpans().map((span) => span.name)).toEqual([
      'work',
    ]);
    expect(first.getFinishedSpans()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('init() called again'),
    );
  });

  // trace() records through a tracer the runtime config holds, resolved before
  // the second init() registered its provider.
  it('trace() records into the replacing pipeline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = new InMemorySpanExporter();
    const second = new InMemorySpanExporter();

    init({ service: 'first', spanExporters: [first] });
    await trace.run('before', async () => {});
    await flush();
    // Read now: shutting the first pipeline down clears an in-memory exporter.
    expect(first.getFinishedSpans().map((span) => span.name)).toEqual([
      'before',
    ]);
    init({ service: 'second', spanExporters: [second] });
    await trace.run('after', async () => {});
    await flush();

    expect(second.getFinishedSpans().map((span) => span.name)).toEqual([
      'after',
    ]);
  });

  // The common pattern: a tracer held in a module constant, taken before a
  // second init() (two setup files that each call it).
  it('a tracer from getTracer() follows the replacing pipeline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = new InMemorySpanExporter();
    init({ service: 'first', spanExporters: [new InMemorySpanExporter()] });
    const early = getTracer('early');
    init({ service: 'second', spanExporters: [second] });

    early.startSpan('started').end();
    early.startActiveSpan('active', (span) => span.end());
    await flush();

    expect(second.getFinishedSpans().map((span) => span.name)).toEqual([
      'started',
      'active',
    ]);
  });

  it('keeps the first pipeline when the second init() throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = new InMemorySpanExporter();
    init({ service: 'first', spanExporters: [first] });

    expect(() =>
      // SAFETY: a factory returning nothing is the failure under test.
      init({ service: 'second', sdkFactory: () => null as never }),
    ).toThrow('sdkFactory must return an SDK instance');
    recordSpan();
    await flush();

    expect(first.getFinishedSpans()).toHaveLength(1);
  });

  it('leaves a propagator the application registered', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const own: TextMapPropagator = {
      inject: () => {},
      extract: (ctx) => ctx,
      fields: () => ['x-own'],
    };
    propagation.setGlobalPropagator(own);

    init({ service: 'first', spanExporters: [new InMemorySpanExporter()] });
    init({ service: 'second', spanExporters: [new InMemorySpanExporter()] });

    expect(propagation.fields()).toEqual(['x-own']);
    propagation.disable();
  });

  // OpenTelemetry patches a module once, when it loads, so a module loaded
  // before the second init() is traced only by the first init()'s
  // instrumentations.
  it("points the first init()'s instrumentations at the new pipeline", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const providers: Array<
      Parameters<Instrumentation['setTracerProvider']>[0]
    > = [];
    // SAFETY: registerInstrumentations and the re-init read only these members.
    const instrumentation = {
      instrumentationName: 'fake',
      instrumentationVersion: '0.0.0',
      enable: () => {},
      disable: () => {},
      setConfig: () => {},
      getConfig: () => ({}),
      setMeterProvider: () => {},
      setTracerProvider: (provider) => providers.push(provider),
    } as Instrumentation;
    const second = new InMemorySpanExporter();

    init({
      service: 'first',
      spanExporters: [new InMemorySpanExporter()],
      instrumentations: [instrumentation],
    });
    init({ service: 'second', spanExporters: [second] });
    providers.at(-1)!.getTracer('fake').startSpan('patched-call').end();
    await flush();

    expect(second.getFinishedSpans().map((span) => span.name)).toEqual([
      'patched-call',
    ]);
  });

  it('keeps a tracer passed to configure() across init()', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    init({ service: 'first', spanExporters: [new InMemorySpanExporter()] });
    const configured = getTracer('configured');
    configure({ tracer: configured });
    init({ service: 'second', spanExporters: [new InMemorySpanExporter()] });

    expect(getConfig().tracer).toBe(configured);
  });

  it('init() after shutdown() exports, without a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    init({ service: 'first', spanExporters: [new InMemorySpanExporter()] });
    await shutdown();

    const exporter = new InMemorySpanExporter();
    init({ service: 'second', spanExporters: [exporter] });
    recordSpan();
    await flush();

    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('init() called again'),
    );
  });
});
