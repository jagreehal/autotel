/**
 * Against the real OpenFeature server SDK: `init()` registers the hook on the
 * app's own OpenFeature, and an evaluation lands on the span that read it.
 */
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { OpenFeature, TypedInMemoryProvider } from '@openfeature/server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { init } from './init';
import { flush, shutdown } from './shutdown';
import {
  ctx,
  getActiveTraceContext,
  trace as autotelTrace,
} from './functional';
import { autotelOpenFeatureHook, recordFeatureFlag } from './feature-flags';

const spans = new InMemorySpanExporter();
const records = new InMemoryLogRecordExporter();

beforeAll(async () => {
  init({
    service: 'openfeature-test',
    sampling: 'development',
    instrumentations: [],
    flushOnExit: false,
    spanProcessors: [new SimpleSpanProcessor(spans)],
    logRecordProcessors: [new SimpleLogRecordProcessor({ exporter: records })],
  });
  await OpenFeature.setProviderAndWait(
    new TypedInMemoryProvider({
      'new-checkout': {
        variants: { on: true, off: false },
        defaultVariant: 'on',
        disabled: false,
      },
    }),
  );
});

afterAll(async () => {
  OpenFeature.clearHooks();
  await OpenFeature.close();
  await shutdown();
  for (const api of [trace, logs, metrics, context, propagation]) api.disable();
});

const run = async (name: string, fn: () => Promise<unknown>) => {
  await autotelTrace(name, fn)();
  await flush();
};

const spanNamed = (name: string) =>
  spans.getFinishedSpans().find((span) => span.name === name);

describe('OpenFeature registered by init()', () => {
  it('records an evaluation on the span that read the flag', async () => {
    const client = OpenFeature.getClient();
    await run('checkout', () =>
      client.getBooleanValue('new-checkout', false, { targetingKey: 'u-1' }),
    );

    expect(spanNamed('checkout')?.attributes).toMatchObject({
      'feature_flag.key': 'new-checkout',
      'feature_flag.result.variant': 'on',
      'feature_flag.result.reason': 'static',
      'feature_flag.context.id': 'u-1',
    });
    expect(
      spanNamed('checkout')?.attributes['feature_flag.result.value'],
    ).toBeUndefined();
    expect(
      records
        .getFinishedLogRecords()
        .some((record) => record.eventName === 'feature_flag.evaluation'),
    ).toBe(true);
  });

  it("records OpenFeature's error code as error.type", async () => {
    const client = OpenFeature.getClient();
    await run('missing', () => client.getBooleanValue('no-such-flag', false));

    expect(spanNamed('missing')?.attributes).toMatchObject({
      'feature_flag.key': 'no-such-flag',
      'feature_flag.result.value': false,
      'feature_flag.result.reason': 'error',
    });
    // The event carries the error class; on the span it would read as the
    // span's own failure.
    expect(spanNamed('missing')?.attributes['error.type']).toBeUndefined();
    const event = records
      .getFinishedLogRecords()
      .find(
        (record) => record.attributes['feature_flag.key'] === 'no-such-flag',
      );
    expect(event?.eventName).toBe('feature_flag.evaluation');
    expect(event?.attributes['error.type']).toBe('flag_not_found');
  });

  it('projects through the shared ambient ctx onto each span', async () => {
    // `ctx` is one object for every span; each span still gets its first flag.
    await run('first-request', async () =>
      recordFeatureFlag(ctx, { key: 'a', value: true }),
    );
    await run('second-request', async () =>
      recordFeatureFlag(ctx, { key: 'b', value: true }),
    );

    expect(spanNamed('first-request')?.attributes['feature_flag.key']).toBe(
      'a',
    );
    expect(spanNamed('second-request')?.attributes['feature_flag.key']).toBe(
      'b',
    );
  });

  it('keeps one span unmixed across fresh trace-context wrappers', async () => {
    await run('two-flags', async () => {
      recordFeatureFlag(getActiveTraceContext(), { key: 'first', value: 'x' });
      recordFeatureFlag(getActiveTraceContext(), {
        key: 'second',
        value: 'y',
        variant: 'on',
        errorMessage: 'stale',
      });
    });

    const attributes = spanNamed('two-flags')?.attributes ?? {};
    expect(attributes['feature_flag.key']).toBe('first');
    expect(attributes['feature_flag.result.value']).toBe('x');
    expect(attributes['feature_flag.result.variant']).toBeUndefined();
    expect(attributes['feature_flag.error.message']).toBeUndefined();
  });

  it("keeps a parent's span unmixed when its saved ctx is used under a child", async () => {
    await autotelTrace.run('parent', async (parentCtx) => {
      recordFeatureFlag(parentCtx, { key: 'first', value: 'x' });
      await autotelTrace.run('child', async () => {
        recordFeatureFlag(parentCtx, {
          key: 'second',
          value: 'y',
          variant: 'on',
        });
      });
    });
    await flush();

    const attributes = spanNamed('parent')?.attributes ?? {};
    expect(attributes['feature_flag.key']).toBe('first');
    expect(attributes['feature_flag.result.variant']).toBeUndefined();
  });

  it('records once when the app also adds the hook to a client', async () => {
    const client = OpenFeature.getClient('with-own-hook');
    client.addHooks(autotelOpenFeatureHook());
    await run('own-hook', () => client.getBooleanValue('new-checkout', false));

    const events = records
      .getFinishedLogRecords()
      .filter(
        (record) =>
          record.eventName === 'feature_flag.evaluation' &&
          record.spanContext?.spanId ===
            spanNamed('own-hook')?.spanContext().spanId,
      );
    expect(events).toHaveLength(1);
  });

  it('records every flag passed with a raw span as an event', async () => {
    await run('raw-span', async () => {
      const span = trace.getActiveSpan();
      recordFeatureFlag(span, { key: 'raw-a', value: true });
      recordFeatureFlag(span, { key: 'raw-b', value: false });
    });

    expect(spanNamed('raw-span')?.attributes['feature_flag.key']).toBe('raw-a');
    const keys = records
      .getFinishedLogRecords()
      .filter(
        (record) =>
          record.spanContext?.spanId ===
          spanNamed('raw-span')?.spanContext().spanId,
      )
      .map((record) => record.attributes['feature_flag.key']);
    expect(keys).toEqual(['raw-a', 'raw-b']);
  });
});
