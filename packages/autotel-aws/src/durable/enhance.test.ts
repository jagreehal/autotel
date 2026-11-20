import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { withDurableExecution } from '@aws/durable-execution-sdk-js';
import type { DurableInstrumentationPluginFactory } from '@aws/durable-execution-sdk-js';
import { createOtelPluginFactory } from '@aws/durable-execution-sdk-js-otel';
import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
import { init, span } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { BatchSpanProcessor } from 'autotel/processors';
import { withInvokeTraceContext } from './context';
import { durableFlush, autotelContextExtractor } from './enhance';
import { withUpdatedOperationIds } from './lambda-emulation';

const flushed = vi.hoisted(() => ({ count: 0 }));
vi.mock('autotel', async (actual) => {
  const real = await actual<typeof import('autotel')>();
  return {
    ...real,
    flush: (...args: Parameters<typeof real.flush>) => {
      flushed.count++;
      return real.flush(...args);
    },
  };
});

// Batched with a long delay, as in Lambda: spans leave only when flushed.
const exporter = new InMemorySpanExporter();
beforeAll(async () => {
  init({
    service: 'test',
    spanProcessors: [
      new BatchSpanProcessor({ exporter, scheduledDelayMillis: 600_000 }),
    ],
  });
  await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
});
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());
beforeEach(() => exporter.reset());

async function run(plugins: DurableInstrumentationPluginFactory[]) {
  const handler = withDurableExecution(
    async (_event: unknown, ctx) => {
      await ctx.wait({ seconds: 5 });
      return ctx.step('charge', async () =>
        span('payment.authorize', async () => 'paid'),
      );
    },
    { plugins },
  );
  const runner = new LocalDurableTestRunner({
    handlerFunction: withUpdatedOperationIds(handler),
  });
  await runner.run({ payload: {} });
  return exporter.getFinishedSpans().map((s) => s.name);
}

it("exports AWS's spans under autotel's provider", async () => {
  // AWS's plugin flushes the provider behind the global proxy itself.
  expect(await run([createOtelPluginFactory()])).toEqual(
    expect.arrayContaining(['Invocation', 'WAIT', 'charge', 'Workflow']),
  );
});

it('flushes autotel and its metrics at the end of every invocation with durableFlush()', async () => {
  let meterFlushes = 0;
  metrics.setGlobalMeterProvider(
    Object.assign(new MeterProvider(), {
      forceFlush: async () => {
        meterFlushes++;
      },
    }),
  );
  try {
    flushed.count = 0;
    await run([createOtelPluginFactory()]);
    expect([flushed.count, meterFlushes]).toEqual([0, 0]);
    // The wait splits the execution into two invocations.
    await run([createOtelPluginFactory(), durableFlush()]);
    expect([flushed.count, meterFlushes]).toEqual([2, 2]);
  } finally {
    metrics.disable();
  }
});

it('puts an execution started by ctx.invoke() in the caller trace', async () => {
  const plugins = () => [
    createOtelPluginFactory({ contextExtractor: autotelContextExtractor }),
    durableFlush(),
  ];
  const caller = withDurableExecution(
    async (_event: unknown, ctx) =>
      ctx.invoke(
        'check',
        'customer-service',
        withInvokeTraceContext({ id: 1 }),
      ),
    { plugins: plugins() },
  );
  const runner = new LocalDurableTestRunner({
    handlerFunction: withUpdatedOperationIds(caller),
  });
  runner.registerDurableFunction(
    'customer-service',
    withUpdatedOperationIds(
      withDurableExecution(
        async (_input: unknown, ctx) => ctx.step('lookup', async () => 'ok'),
        { plugins: plugins() },
      ),
    ),
  );
  await runner.run({ payload: {} });

  const spans = exporter.getFinishedSpans();
  const traceOf = (name: string) =>
    spans.find((s) => s.name === name)?.spanContext().traceId;
  expect(traceOf('lookup')).toBeDefined();
  expect(traceOf('lookup')).toBe(traceOf('check'));
});

it("keeps Lambda's X-Ray trace but lets autotel decide sampling", async () => {
  // What Lambda sets for a durable function without active tracing.
  process.env._X_AMZN_TRACE_ID =
    'Root=1-6acb482d-2b8f1c464b840b63538e6767;Parent=5e20bd4fd20c56b4;Sampled=0';
  try {
    // Nothing, autotel's own span included: it follows its dropped parent.
    expect(await run([createOtelPluginFactory(), durableFlush()])).toEqual([]);

    await run([
      createOtelPluginFactory({ contextExtractor: autotelContextExtractor }),
      durableFlush(),
    ]);
    const workflow = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'Workflow');
    expect(workflow?.spanContext().traceId).toBe(
      '6acb482d2b8f1c464b840b63538e6767',
    );
    expect(workflow?.parentSpanContext?.spanId).toBe('5e20bd4fd20c56b4');
  } finally {
    delete process.env._X_AMZN_TRACE_ID;
  }
});
