import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  context,
  ProxyTracerProvider,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
  type TracerProvider,
} from '@opentelemetry/api';
import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';

/**
 * Next.js and Prisma behaviour, each against a real init() and an in-memory
 * exporter. init() and its tracer are module singletons, so every
 * test loads a fresh autotel.
 */
/* eslint-disable eslint-js/no-restricted-syntax */
async function load() {
  vi.resetModules();
  otelTrace.disable();
  return {
    ...(await import('./init')),
    ...(await import('./functional')),
    ...(await import('./shutdown')),
  };
}
/* eslint-enable eslint-js/no-restricted-syntax */

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * An in-memory exporter that keeps its spans through shutdown, which is what
 * flushes them; the stock one forgets them there.
 */
class KeepingExporter extends InMemorySpanExporter {
  override shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

async function finished(
  exporter: InMemorySpanExporter,
  shutdown: () => Promise<void>,
) {
  await shutdown();
  return exporter.getFinishedSpans();
}

/** Names of the exported spans. */
async function exported(
  exporter: InMemorySpanExporter,
  shutdown: () => Promise<void>,
): Promise<string[]> {
  const spans = await finished(exporter, shutdown);
  return spans.map((span) => span.name).toSorted();
}

/** One span with the given parent, kind and attributes, ended at once. */
function emit(
  name: string,
  options: {
    scope?: string;
    kind?: SpanKind;
    attributes?: Record<string, string | number>;
  },
  children: () => void = () => {},
): void {
  const tracer = otelTrace.getTracer(options.scope ?? 'test');
  const span = tracer.startSpan(name, {
    kind: options.kind ?? SpanKind.INTERNAL,
    attributes: options.attributes,
  });
  context.with(otelTrace.setSpan(context.active(), span), children);
  span.end();
}

/**
 * The same `enable()` as `@prisma/instrumentation`: it publishes a helper
 * holding `this.tracerProvider ?? trace.getTracerProvider()`, and runs from
 * the constructor. `bundled` stands in for the `@opentelemetry/api` copy a
 * bundler gave the instrumentation: its proxy is never connected to anything.
 */
class PrismaLikeInstrumentation extends InstrumentationBase {
  helper: TracerProvider | undefined;
  private provider: TracerProvider | undefined;

  constructor(private readonly bundled: TracerProvider) {
    super('@prisma/instrumentation', '6.19.3', {});
  }
  init() {
    return [new InstrumentationNodeModuleDefinition('@prisma/client', ['*'])];
  }
  override setTracerProvider(provider: TracerProvider) {
    this.provider = provider;
  }
  override enable() {
    this.helper = this.provider ?? this.bundled;
  }
  override disable() {
    this.helper = undefined;
  }
}

describe('Prisma instrumentation passed to init()', () => {
  it('publishes the registered provider, not the one it saw at construction', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    const prisma = new PrismaLikeInstrumentation(new ProxyTracerProvider());

    init({
      service: 'next-prisma',
      spanExporters: [exporter],
      instrumentations: [prisma],
    });
    prisma.helper
      ?.getTracer('prisma')
      .startSpan('prisma:client:operation')
      .end();

    expect(await exported(exporter, shutdown)).toEqual([
      'prisma:client:operation',
    ]);
  });
});

/**
 * Next's own server span carries the old `http.target`, not `url.path`, so the
 * obvious health filter misses it. `ignoreRoutes` matches every name a route
 * goes by and drops the whole request, children included.
 */
describe('ignoreRoutes', () => {
  it('drops a request by url.path, http.target, http.route or next.route', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({
      service: 'routes',
      spanExporters: [exporter],
      ignoreRoutes: ['/api/health', /^\/_next\//],
    });

    emit(
      'GET /api/health',
      {
        scope: 'next.js',
        kind: SpanKind.SERVER,
        attributes: { 'http.target': '/api/health?probe=1' },
      },
      () => emit('prisma:client:operation', {}),
    );
    emit('GET', {
      kind: SpanKind.SERVER,
      attributes: { 'url.path': '/api/health/deep' },
    });
    emit('GET /_next/static', {
      kind: SpanKind.SERVER,
      attributes: { 'next.route': '/_next/static/chunks/x.js' },
    });
    emit('GET /api/healthcare', {
      kind: SpanKind.SERVER,
      attributes: { 'url.path': '/api/healthcare' },
    });
    // An outbound call to someone else's health route is not this app's route.
    emit('GET', {
      kind: SpanKind.CLIENT,
      attributes: { 'url.path': '/api/health' },
    });

    expect(await exported(exporter, shutdown)).toEqual([
      'GET',
      'GET /api/healthcare',
    ]);
  });

  it('judges a request by its resolved route, and a raw path once normalized', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({
      service: 'routes',
      spanExporters: [exporter],
      ignoreRoutes: ['/api/health'],
    });

    // The router resolved /admin; the raw path only claims to be health.
    emit('GET /admin', {
      kind: SpanKind.SERVER,
      attributes: {
        'url.path': '/api/health/../../admin',
        'http.route': '/admin',
      },
    });
    emit('GET raw', {
      kind: SpanKind.SERVER,
      attributes: { 'url.path': '/api/health/%2e%2e/%2e%2e/admin' },
    });

    expect(await exported(exporter, shutdown)).toEqual([
      'GET /admin',
      'GET raw',
    ]);
  });

  it("matches '/' as the root route only", async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({ service: 'routes', spanExporters: [exporter], ignoreRoutes: ['/'] });

    emit('GET /', { kind: SpanKind.SERVER, attributes: { 'url.path': '/' } });
    emit('GET /users', {
      kind: SpanKind.SERVER,
      attributes: { 'url.path': '/users' },
    });

    expect(await exported(exporter, shutdown)).toEqual(['GET /users']);
  });
});

/**
 * Next's fetch spans, beside the undici span for the same request. Next sets
 * NEXT_RUNTIME for instrumentation.ts, which is where init() runs.
 */
describe('Next.js fetch spans', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps spanProcessors: [] an off switch', async () => {
    const { init } = await load();
    let processors: unknown[] = [];
    init({
      service: 'off',
      spanProcessors: [],
      sdkFactory: (options) => {
        processors = options.spanProcessors ?? [];
        return { start() {}, shutdown: async () => {} };
      },
    });
    expect(processors.map((p) => (p as object).constructor.name)).toEqual([
      'NoopSpanProcessor',
    ]);
  });

  class UndiciLikeInstrumentation extends InstrumentationBase {
    constructor() {
      super('@opentelemetry/instrumentation-undici', '0.33.0', {});
    }
    init() {
      return [];
    }
  }

  const nextFetch = (url: string) =>
    emit(`fetch GET ${url}`, {
      scope: 'next.js',
      kind: SpanKind.CLIENT,
      attributes: { 'next.span_type': 'AppRender.fetch' },
    });

  it('drops the query string from the span name', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({ service: 'next', spanExporters: [exporter] });

    nextFetch('https://bank.example/balances?on_behalf_of=1234-5678');

    expect(await exported(exporter, shutdown)).toEqual([
      'fetch GET https://bank.example/balances',
    ]);
  });

  it('drops the fetch span when undici traces the same call, keeping undici and its parent', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({
      service: 'next',
      spanExporters: [exporter],
      instrumentations: [new UndiciLikeInstrumentation()],
    });

    emit('GET /api/outbound', { kind: SpanKind.SERVER }, () =>
      emit(
        'fetch GET https://example.com/',
        {
          scope: 'next.js',
          kind: SpanKind.CLIENT,
          attributes: { 'next.span_type': 'AppRender.fetch' },
        },
        () =>
          emit('GET', {
            scope: '@opentelemetry/instrumentation-undici',
            kind: SpanKind.CLIENT,
          }),
      ),
    );

    const spans = await finished(exporter, shutdown);
    expect(spans.map((s) => s.name).toSorted()).toEqual([
      'GET',
      'GET /api/outbound',
    ]);
    const server = spans.find((s) => s.name === 'GET /api/outbound')!;
    const undici = spans.find((s) => s.name === 'GET')!;
    expect(undici.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
  });

  it('keeps the fetch span when undici is registered but traced nothing under it', async () => {
    // Reported: undici registered, no undici span. Next's is then the only
    // record of the call.
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({
      service: 'next',
      spanExporters: [exporter],
      instrumentations: [new UndiciLikeInstrumentation()],
    });

    nextFetch('https://example.com/');

    expect(await exported(exporter, shutdown)).toEqual([
      'fetch GET https://example.com/',
    ]);
  });

  it('keeps an app call whose URL only mentions the telemetry host', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({ service: 'next', spanExporters: [exporter] });

    nextFetch('https://bank.example/search?q=telemetry.nextjs.org');
    emit('GET', {
      kind: SpanKind.CLIENT,
      attributes: {
        'url.full': 'https://bank.example/search?q=telemetry.nextjs.org',
      },
    });

    expect(await exported(exporter, shutdown)).toEqual([
      'GET',
      'fetch GET https://bank.example/search',
    ]);
  });

  it("drops Next's own telemetry call", async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({ service: 'next', spanExporters: [exporter] });

    nextFetch('https://telemetry.nextjs.org/api/v1/record');
    emit('POST', {
      kind: SpanKind.CLIENT,
      attributes: { 'url.full': 'https://telemetry.nextjs.org/api/v1/record' },
    });

    expect(await exported(exporter, shutdown)).toEqual([]);
  });

  it('keeps a server span whatever host the request named', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({ service: 'next', spanExporters: [exporter] });

    emit('GET /admin', {
      kind: SpanKind.SERVER,
      attributes: { 'url.full': 'https://telemetry.nextjs.org/admin' },
    });

    expect(await exported(exporter, shutdown)).toEqual(['GET /admin']);
  });
});

describe('a status set with the plain OpenTelemetry API inside trace()', () => {
  it('is exported as set, not overwritten with OK', async () => {
    const { init, trace, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({ service: 'status', spanExporters: [exporter] });

    await trace('raw.status', async () => {
      otelTrace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
      return 'ok';
    })();

    const [span] = await finished(exporter, shutdown);
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('resource attributes', () => {
  it('names the host once, under the convention, with no vendor copy', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    init({ service: 'host', spanExporters: [exporter] });

    emit('work', {});

    const [span] = await finished(exporter, shutdown);
    expect(span?.resource.attributes['host.name']).toBeTypeOf('string');
    expect(span?.resource.attributes).not.toHaveProperty('datadog.host.name');
  });
});

/**
 * A bundler can give an instrumentation its own `@opentelemetry/api` copy.
 * Its spans then go to that copy's provider. The copy shows in the diag logger InstrumentationBase builds from it.
 */
describe('an instrumentation on another @opentelemetry/api copy', () => {
  class OtherCopyDiagLogger {}
  class Instrumentation extends InstrumentationBase {
    constructor(name: string, otherCopy: boolean) {
      super(name, '1.0.0', {});
      if (otherCopy) {
        // What InstrumentationBase built with a different API copy.
        (this as unknown as { _diag: object })._diag =
          new OtherCopyDiagLogger();
      }
    }
    init() {
      return [];
    }
  }

  const copyWarnings = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls
      .map(([message]: unknown[]) => String(message))
      .filter((message: string) => message.includes('@opentelemetry/api'));

  it('is named in a warning, once', async () => {
    const { init, shutdown } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    init({
      service: 'copies',
      spanExporters: [new KeepingExporter()],
      instrumentations: [
        new Instrumentation('@acme/instrumentation-bundled', true),
        new Instrumentation('@acme/instrumentation-shared', false),
      ],
    });
    await shutdown();

    const warnings = copyWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('@acme/instrumentation-bundled');
    expect(warnings[0]).not.toContain('@acme/instrumentation-shared');
    expect(warnings[0]).toContain('withAutotelConfig');
  });

  it('stays quiet when every instrumentation shares autotel’s copy', async () => {
    const { init, shutdown } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    init({
      service: 'one-copy',
      spanExporters: [new KeepingExporter()],
      instrumentations: [new Instrumentation('@acme/instrumentation', false)],
    });
    await shutdown();

    expect(copyWarnings(warn)).toEqual([]);
  });
});

describe('ignoreRoutes with a stateful pattern', () => {
  it('drops every matching request, not every other one', async () => {
    const { init, shutdown } = await load();
    const exporter = new KeepingExporter();
    const pattern = /^\/health/g;
    init({
      service: 'routes',
      spanExporters: [exporter],
      ignoreRoutes: [pattern],
    });

    for (let i = 0; i < 4; i++) {
      emit('GET /health', {
        kind: SpanKind.SERVER,
        attributes: { 'url.path': '/health' },
      });
    }

    expect(await exported(exporter, shutdown)).toEqual([]);
    expect(pattern.lastIndex).toBe(0);
  });
});
