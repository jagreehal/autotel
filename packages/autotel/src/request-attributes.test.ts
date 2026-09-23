import {
  context,
  createContextKey,
  trace as otelTrace,
} from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestCtx, span } from './functional';
import { init } from './init';

/** What `instrumentation-http` publishes the server span under. */
const RPC_METADATA_KEY = createContextKey(
  'OpenTelemetry SDK Context Key RPC_METADATA',
);

/**
 * The real `init()` pipeline, not `createTraceCollector()`: the collector's
 * mock tracer skips span processors, and the copy is done by the one `init()`
 * registers by default.
 */
describe('requestCtx attributes on the spans a request starts', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    init({
      service: 'request-attributes-test',
      sampling: 'development',
      spanProcessor: new SimpleSpanProcessor(exporter),
      attributeRedactor: { keyPatterns: [/^secret$/] },
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  it.each(['setAttribute', 'setAttributes'] as const)(
    '%s reads each getter once and inherits the same value',
    async (method) => {
      let reads = 0;
      const user = {
        get id() {
          return `u_${++reads}`;
        },
      };
      span({ name: 'request' }, () => {
        if (method === 'setAttribute') requestCtx.setAttribute('user', user);
        else requestCtx.setAttributes({ user });
        span({ name: 'child' }, () => {});
      });
      await expect.poll(() => exporter.getFinishedSpans().length).toBe(2);
      expect(reads).toBe(1);
      expect(
        exporter.getFinishedSpans().map((s) => s.attributes['user.id']),
      ).toEqual(['u_1', 'u_1']);
    },
  );

  it('does not retain ended ancestors, but keeps their attributes', () => {
    // A separate process exposes GC without changing the test runner's heap.
    execFileSync(
      process.execPath,
      [
        '--expose-gc',
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import { setImmediate } from 'node:timers/promises';
      import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
      import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
      import { RequestAttributesSpanProcessor, rememberRequestAttributes }
        from ${JSON.stringify(new URL('request-attributes.ts', import.meta.url).href)};
      const provider = new BasicTracerProvider({
        spanProcessors: [new RequestAttributesSpanProcessor()],
      });
      const tracer = provider.getTracer('retention-test');
      function startChild(tagged) {
        const parent = tracer.startSpan('parent');
        if (tagged) rememberRequestAttributes(parent, { tenant: 't_1' });
        const child = tracer.startSpan('child', {}, trace.setSpan(ROOT_CONTEXT, parent));
        parent.end();
        return { parent: new WeakRef(parent), child };
      }
      const retained = [startChild(false), startChild(true)];
      for (let i = 0; i < 10; i++) {
        await setImmediate();
        global.gc();
      }
      for (const entry of retained) assert.equal(entry.parent.deref(), undefined);
      const grandchild = tracer.startSpan('grandchild', {}, trace.setSpan(ROOT_CONTEXT, retained[1].child));
      assert.equal(grandchild.attributes.tenant, 't_1');
      grandchild.end();
      for (const entry of retained) entry.child.end();
      await provider.shutdown();
    `,
      ],
      { cwd: new URL('..', import.meta.url), timeout: 10_000, stdio: 'pipe' },
    );
  });

  it('sees later ancestor tags through an already-started child', async () => {
    await span({ name: 'parent' }, async () => {
      const child = span({ name: 'child' }, async () => {
        await setImmediate();
        span({ name: 'grandchild' }, () => {});
      });
      requestCtx.setAttribute('tenant', 'late');
      await child;
    });
    await expect.poll(() => exporter.getFinishedSpans().length).toBe(3);
    expect(
      exporter.getFinishedSpans().find((s) => s.name === 'child')?.attributes
        .tenant,
    ).toBeUndefined();
    expect(
      exporter.getFinishedSpans().find((s) => s.name === 'grandchild')
        ?.attributes.tenant,
    ).toBe('late');
  });

  it('redacts inherited attributes before export', async () => {
    span({ name: 'parent' }, () => {
      requestCtx.setAttributes({ secret: 'private-value', tenant: 't_1' });
      span({ name: 'child' }, () => {});
    });
    await expect.poll(() => exporter.getFinishedSpans().length).toBe(2);
    for (const finished of exporter.getFinishedSpans()) {
      expect(finished.attributes.secret).toBe('[REDACTED]');
      expect(finished.attributes.tenant).toBe('t_1');
    }
  });

  it('isolates overlapping requests and leaves baggage unchanged', async () => {
    await Promise.all(
      ['t_1', 't_2'].map((tenant) =>
        span({ name: tenant }, async () => {
          const active = context.active().setValue(RPC_METADATA_KEY, {
            type: 'http',
            span: otelTrace.getActiveSpan(),
          });
          await context.with(active, async () => {
            const baggage = requestCtx.getAllBaggage();
            requestCtx.setAttribute('tenant', tenant);
            await setImmediate();
            span({ name: `${tenant}.child` }, () => {
              expect(requestCtx.getAllBaggage()).toEqual(baggage);
            });
          });
        }),
      ),
    );
    await expect.poll(() => exporter.getFinishedSpans().length).toBe(4);
    for (const finished of exporter.getFinishedSpans()) {
      expect(finished.attributes.tenant).toBe(finished.name.split('.')[0]);
    }
  });

  it('carries onto spans started afterwards, at any depth', async () => {
    span({ name: 'GET /orders' }, () => {
      const active = context.active().setValue(RPC_METADATA_KEY, {
        type: 'http',
        span: otelTrace.getActiveSpan(),
      });
      context.with(active, () => {
        span({ name: 'middleware - auth' }, () => {
          requestCtx.setAttributes({ user: { id: 'u_1' }, tenant: 't_1' });
        });
        span({ name: 'handler' }, () => {
          span({ name: 'db.query', attributes: { tenant: 'own' } }, () => {});
        });
      });
    });

    await expect
      .poll(() => exporter.getFinishedSpans().length, { timeout: 1000 })
      .toBe(4);
    const attrs = (name: string) =>
      exporter.getFinishedSpans().find((s) => s.name === name)?.attributes;
    expect(attrs('GET /orders')?.['user.id']).toBe('u_1');
    expect(attrs('handler')?.['user.id']).toBe('u_1');
    expect(attrs('db.query')?.['user.id']).toBe('u_1');
    // A span's own value wins over the inherited one.
    expect(attrs('db.query')?.['tenant']).toBe('own');
    // Only spans started after the call: the layer that set it came first.
    expect(attrs('middleware - auth')?.['user.id']).toBeUndefined();
  });

  it('carries onto spans under the active span outside a request', async () => {
    // A queue consumer: no request span, so requestCtx is the active span.
    span({ name: 'consume order' }, () => {
      span({ name: 'started before' }, () => {
        requestCtx.setAttribute('ignored', 'nested');
      });
      requestCtx.setAttribute('job.id', 'j_1');
      span({ name: 'process' }, () => {
        span({ name: 'db.write' }, () => {});
      });
    });
    await expect
      .poll(() => exporter.getFinishedSpans().length, { timeout: 1000 })
      .toBe(4);

    const attrs = (name: string) =>
      exporter.getFinishedSpans().find((s) => s.name === name)?.attributes;
    expect(attrs('process')?.['job.id']).toBe('j_1');
    expect(attrs('db.write')?.['job.id']).toBe('j_1');
    expect(attrs('started before')?.['job.id']).toBeUndefined();
    // Tagged on the nested span it fell back to, so its sibling never sees it.
    expect(attrs('process')?.['ignored']).toBeUndefined();
  });

  it('merges nested tags outside a request, the nearer one winning', async () => {
    span({ name: 'consume' }, () => {
      requestCtx.setAttributes({ tenant: 't_1', stage: 'consume' });
      span({ name: 'job' }, () => {
        requestCtx.setAttributes({ 'job.id': 'j_1', stage: 'job' });
        span({ name: 'step' }, () => {});
      });
    });
    await expect
      .poll(() => exporter.getFinishedSpans().length, { timeout: 1000 })
      .toBe(3);

    const step = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'step')?.attributes;
    expect(step?.['tenant']).toBe('t_1');
    expect(step?.['job.id']).toBe('j_1');
    expect(step?.['stage']).toBe('job');
  });
});
import { execFileSync } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
