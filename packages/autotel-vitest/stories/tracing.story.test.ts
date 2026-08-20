import { test, expect, otelTestCollector } from 'autotel-vitest';
import { story } from 'executable-stories-vitest';
import { flush, getTraceContext, instrument } from 'autotel';
import type { SerializedSpan } from 'autotel/test-span-collector';

/**
 * The spans this scenario produced, for assertions and for the doc tables.
 *
 * Nothing here is needed to get the spans into the report: the fixture drains
 * the same collector onto task.meta after the test, and the executable-stories
 * reporter renders that as a trace waterfall on its own.
 */
async function spansUnderTest(): Promise<SerializedSpan[]> {
  await flush();
  const ctx = getTraceContext();
  if (!ctx) return [];
  return otelTestCollector
    .peekTrace(ctx.traceId, ctx.spanId)
    .filter((span) => span.spanId !== ctx.spanId);
}

const chargeCard = instrument({
  key: 'payment.charge',
  fn: (amount: number) => {
    if (amount <= 0) throw new Error(`invalid amount: ${amount}`);
    return { captured: amount };
  },
});

const checkout = instrument({
  key: 'checkout',
  fn: (amount: number) => chargeCard(amount),
});

test('A traced function records a span named after the operation', async ({
  task,
}) => {
  story.init(task);

  story.given('a payment function wrapped once with autotel trace()', {
    code: {
      label: 'The whole instrumentation',
      content: `const chargeCard = instrument({ key: 'payment.charge', fn: (amount: number) => {
  if (amount <= 0) throw new Error(\`invalid amount: \${amount}\`);
  return { captured: amount };
} });`,
      lang: 'typescript',
    },
  });

  const result = story.when('the function is called', () => chargeCard(2500));

  story.then('it returns its ordinary value, unchanged by instrumentation', {
    kv: { captured: result.captured },
  });
  expect(result).toEqual({ captured: 2500 });

  const spans = await spansUnderTest();
  story.and('a span was recorded without a single line of tracing code', {
    table: {
      label: 'Spans recorded by this scenario',
      columns: ['name', 'status'],
      rows: spans.map((span) => [span.name, span.status]),
    },
  });
  expect(spans.map((span) => span.name)).toContain('payment.charge');
});

test('A traced function that throws records the failure on its span', async ({
  task,
}) => {
  story.init(task);

  story.given('the same payment function, with no error handling added');

  story.when('it is called with an amount it rejects', () => {
    expect(() => chargeCard(-1)).toThrow('invalid amount: -1');
  });

  const span = (await spansUnderTest()).find(
    (candidate) => candidate.name === 'payment.charge',
  );

  story.then('the span is marked as failed', {
    kv: { status: span?.status, message: span?.statusMessage },
  });
  expect(span?.status).toBe('error');

  story.but('the error still propagates to the caller unchanged', {
    note: 'autotel records the exception and rethrows. It never swallows a failure.',
  });
});

test('Nested traced calls join the trace of the test that ran them', async ({
  task,
}) => {
  story.init(task);

  story.given('a checkout function that calls the payment function', {
    code: {
      label: 'Two independently traced functions',
      content: `const checkout = instrument({ key: 'checkout', fn: (amount: number) => chargeCard(amount) });`,
      lang: 'typescript',
    },
  });

  story.when('checkout runs', () => checkout(4200));

  const spans = await spansUnderTest();
  const outer = spans.find((span) => span.name === 'checkout');
  const inner = spans.find((span) => span.name === 'payment.charge');

  story.then('the inner span is a child of the outer one', {
    mermaid: {
      title: 'Trace shape recorded by this run',
      code: [
        'graph TD',
        '  T["test span"] --> C["checkout"]',
        '  C --> P["payment.charge"]',
      ].join('\n'),
    },
  });
  expect(outer).toBeDefined();
  expect(inner?.parentSpanId).toBe(outer?.spanId);

  story.and('both hang off the span the test fixture opened', {
    note: 'One span per test, so a whole test run is filterable in the backend by test name.',
  });
  expect(outer?.parentSpanId).toBe(getTraceContext()?.spanId);
});
