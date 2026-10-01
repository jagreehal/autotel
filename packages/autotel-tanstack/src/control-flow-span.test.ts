import { SpanStatusCode } from '@opentelemetry/api';
import { redirect } from '@tanstack/react-router';
import { init, trace } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { traceBeforeLoad, traceLoader } from './loaders';

describe('TanStack control-flow span handling', () => {
  // init() registers the context manager the ambient getActiveTraceContext()
  // reads; without it the mock span never becomes the active span.
  beforeAll(() => {
    init({ service: 'tanstack-control-flow-test' });
  });

  it('does not record redirect() as a loader span error', async () => {
    const collector = createTraceCollector();
    const signal = redirect({ to: '/login' });
    const loading = traceLoader({ route: { id: '/private' } }, async () => {
      throw signal;
    });

    await expect(loading).rejects.toBe(signal);

    const [span] = collector.getSpansByName('tanstack.loader./private');
    expect(span).toBeDefined();
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes.error).not.toBe(true);
  });

  it('nests spans started inside an async loader under the loader span', async () => {
    const collector = createTraceCollector();
    await traceLoader({ route: { id: '/nested-async' } }, async () => {
      await Promise.resolve();
      return trace.run('db.query', () => 'rows');
    });

    const [loader] = collector.getSpansByName('tanstack.loader./nested-async');
    const [child] = collector.getSpansByName('db.query');
    expect(child.parentSpanId).toBe(loader.spanId);
    expect(child.traceId).toBe(loader.traceId);
  });

  it('nests spans started inside a sync beforeLoad under its span', () => {
    const collector = createTraceCollector();
    traceBeforeLoad({ route: { id: '/nested-sync' } }, () =>
      trace.run('auth.check', () => true),
    );

    const [beforeLoad] = collector.getSpansByName(
      'tanstack.beforeLoad./nested-sync',
    );
    const [child] = collector.getSpansByName('auth.check');
    expect(child.parentSpanId).toBe(beforeLoad.spanId);
  });

  it('marks a real loader error as an error on the span', async () => {
    const collector = createTraceCollector();
    const failure = new Error('db down');

    await expect(
      traceLoader({ route: { id: '/unavailable' } }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const [span] = collector.getSpansByName('tanstack.loader./unavailable');
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes['exception.message']).toBe('db down');
  });

  it('marks a beforeLoad redirect as OK and flags it', async () => {
    const collector = createTraceCollector();
    const signal = redirect({ to: '/login' });

    await expect(
      traceBeforeLoad({ route: { id: '/guarded' } }, async () => {
        throw signal;
      }),
    ).rejects.toBe(signal);

    const [span] = collector.getSpansByName('tanstack.beforeLoad./guarded');
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes['tanstack.beforeLoad.redirect']).toBe(true);
    expect(span.attributes.error).not.toBe(true);
  });

  it('records the loader result when captureResult is on', async () => {
    const collector = createTraceCollector();
    await traceLoader(
      { route: { id: '/result' } },
      async () => ({ count: 2 }),
      { captureResult: true },
    );

    const [span] = collector.getSpansByName('tanstack.loader./result');
    expect(span.attributes['tanstack.loader.result']).toBe('{"count":2}');
  });
});
