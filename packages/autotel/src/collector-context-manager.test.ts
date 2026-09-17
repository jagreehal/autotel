/**
 * `createTraceCollector()` sets the mock span as active with `context.with()`,
 * which propagates only through a registered context manager. This file
 * disables the one `vitest.setup.ts` registers to run as a project that never
 * called `init()` would.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { context, trace as otelTrace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { ctx, trace } from './functional';
import { init } from './init';
import { shutdown } from './shutdown';
import { createMemoryExporter } from './memory-exporter';
import { createTraceCollector } from './testing';

beforeAll(() => context.disable());
afterAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
});

describe('createTraceCollector without a global context manager', () => {
  it('ambient ctx reaches the collected span', async () => {
    const collector = createTraceCollector();
    const wrapped = trace('ambient', async (id: string) => {
      ctx.setAttribute('user.id', id);
    });

    await wrapped('u_1');

    expect(collector.expectSpan('ambient').attributes).toMatchObject({
      'user.id': 'u_1',
    });
  });

  it('nested calls produce a parent/child pair', async () => {
    const collector = createTraceCollector();
    const child = trace('child', async () => {});
    const parent = trace('parent', async () => child());

    await parent();

    expect(collector.expectSpan('child').parentSpanId).toBe(
      collector.expectSpan('parent').spanId,
    );
  });

  it('binds an EventEmitter to the span active when bind() was called', async () => {
    // The real manager patches addListener so a listener runs in the context
    // that bound it. A manager without that support drops the parent span on
    // every event-driven continuation, which is most of Node.
    const collector = createTraceCollector();
    // eslint-disable-next-line unicorn/prefer-event-target -- bind() semantics under test
    const emitter = new EventEmitter();
    let seen: string | undefined;

    const wrapped = trace('bound', async () => {
      context.bind(context.active(), emitter);
      emitter.on('done', () => {
        seen = otelTrace.getActiveSpan()?.spanContext().spanId;
      });
    });
    await wrapped();
    emitter.emit('done');

    expect(seen).toBe(collector.expectSpan('bound').spanId);
  });

  it('leaves a later init() with working binding and nesting', async () => {
    const collector = createTraceCollector();
    init({
      service: 'after-collector',
      spanExporters: [createMemoryExporter()],
    });
    try {
      // eslint-disable-next-line unicorn/prefer-event-target -- bind() semantics under test
      const emitter = new EventEmitter();
      let seen: string | undefined;
      const child = trace('sdk.child', async () => {});
      const parent = trace('sdk.parent', async () => {
        context.bind(context.active(), emitter);
        emitter.on('done', () => {
          seen = otelTrace.getActiveSpan()?.spanContext().spanId;
        });
        await child();
      });
      await parent();
      emitter.emit('done');

      const parentSpan = collector.expectSpan('sdk.parent');
      expect(collector.expectSpan('sdk.child').parentSpanId).toBe(
        parentSpan.spanId,
      );
      expect(seen).toBe(parentSpan.spanId);
    } finally {
      await shutdown();
    }
  });
});
