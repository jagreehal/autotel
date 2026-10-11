import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { withDurableExecution } from '@aws/durable-execution-sdk-js';
import type { DurableInstrumentationPlugin } from '@aws/durable-execution-sdk-js';
import { ExecutionOtelPlugin } from '@aws/durable-execution-sdk-js-otel';
import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
import { init, span } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { BatchSpanProcessor } from 'autotel/processors';
import { withInvokeTraceContext } from './context';
import { durableFlush, autotelContextExtractor } from './enhance';
import { withUpdatedOperationIds } from './lambda-emulation';

// Batched with a long delay, as in Lambda: spans leave only when flushed.
const exporter = new InMemorySpanExporter();
beforeAll(async () => {
  init({
    service: 'test',
    spanProcessors: [
      new BatchSpanProcessor(exporter, { scheduledDelayMillis: 600_000 }),
    ],
  });
  await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
});
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());
beforeEach(() => exporter.reset());

async function run(plugins: DurableInstrumentationPlugin[]) {
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

it("exports AWS's spans under autotel only with durableFlush()", async () => {
  // Under init() AWS's plugin sees the global proxy, which cannot flush.
  expect(await run([new ExecutionOtelPlugin()])).toEqual([]);

  expect(await run([new ExecutionOtelPlugin(), durableFlush()])).toEqual(
    expect.arrayContaining(['Invocation', 'WAIT', 'charge', 'Workflow']),
  );
});

it('puts an execution started by ctx.invoke() in the caller trace', async () => {
  const plugins = () => [
    new ExecutionOtelPlugin({ contextExtractor: autotelContextExtractor }),
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
    expect(await run([new ExecutionOtelPlugin(), durableFlush()])).toEqual([]);

    await run([
      new ExecutionOtelPlugin({ contextExtractor: autotelContextExtractor }),
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
