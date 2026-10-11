import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  BatchLogRecordProcessor,
  InMemoryLogRecordExporter,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSdk, init } from './init';
import { flush, shutdown } from './shutdown';

function resetProviders() {
  trace.disable();
  logs.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
}
afterEach(async () => {
  await shutdown();
  resetProviders();
});

function setup() {
  resetProviders();
  const spans = new InMemorySpanExporter();
  const records = new InMemoryLogRecordExporter();
  init({
    service: 'flush-signals-test',
    sampling: 'development',
    instrumentations: [],
    flushOnExit: false,
    spanProcessors: [
      new BatchSpanProcessor(spans, { scheduledDelayMillis: 600_000 }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: records,
        scheduledDelayMillis: 600_000,
      }),
    ],
  });
  return { spans, records };
}

describe('flush with real batched providers', () => {
  it('exports pending logs alongside spans without waiting for the batch timer', async () => {
    const { spans, records } = setup();
    trace.getTracer('test').startSpan('charge').end();
    logs.getLogger('test').emit({ body: 'charged' });
    expect(spans.getFinishedSpans()).toHaveLength(0);
    expect(records.getFinishedLogRecords()).toHaveLength(0);
    await flush();
    expect(spans.getFinishedSpans().map((span) => span.name)).toEqual([
      'charge',
    ]);
    expect(
      records.getFinishedLogRecords().map((record) => record.body),
    ).toEqual(['charged']);
  });

  it('exports logs even when the trace processor rejects its flush', async () => {
    const { records } = setup();
    const provider = getSdk()!.getTracerProvider!()!;
    const fail = vi
      .spyOn(provider, 'forceFlush')
      .mockRejectedValue(new Error('trace export failed'));
    try {
      logs.getLogger('test').emit({ body: 'failure detail' });
      await expect(flush()).resolves.toBeUndefined();
      expect(
        records.getFinishedLogRecords().map((record) => record.body),
      ).toEqual(['failure detail']);
    } finally {
      fail.mockRestore();
    }
  });

  it('flushes a logger provider registered by a custom sdkFactory', async () => {
    resetProviders();
    const records = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor({
          exporter: records,
          scheduledDelayMillis: 600_000,
        }),
      ],
    });
    init({
      service: 'custom-sdk-logs',
      instrumentations: [],
      flushOnExit: false,
      sdkFactory: () => ({
        start: () => {
          logs.setGlobalLoggerProvider(provider);
        },
        shutdown: () => provider.shutdown(),
      }),
    });
    logs.getLogger('test').emit({ body: 'custom SDK log' });
    await flush();
    expect(
      records.getFinishedLogRecords().map((record) => record.body),
    ).toEqual(['custom SDK log']);
  });

  it('keeps the providers usable after repeated flushes without duplicating logs', async () => {
    const { records } = setup();
    const logger = logs.getLogger('test');
    logger.emit({ body: 'first invocation' });
    await flush();
    await flush();
    logger.emit({ body: 'second invocation' });
    await flush();
    expect(
      records.getFinishedLogRecords().map((record) => record.body),
    ).toEqual(['first invocation', 'second invocation']);
  });
});
