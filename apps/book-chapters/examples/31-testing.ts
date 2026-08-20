import { instrument, withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';

async function main() {
  console.log('=== Chapter 31: Testing ===\n');

  // createTraceCollector() swaps in an in-memory tracer — no init(),
  // no exporter, no flush. Spans are captured synchronously.
  const collector = createTraceCollector();

  const double = withTracing({ name: 'test-operation' })(
    (ctx) => (n: number) => {
      ctx.setAttribute('input', n);
      return n * 2;
    },
  );
  console.log('  double(21) →', double(21));

  // expectSpan(name) — exactly one matching span or it throws
  const span = collector.expectSpan('test-operation');
  if (span.attributes['input'] !== 21) {
    throw new Error(
      `Expected input=21, got ${String(span.attributes['input'])}`,
    );
  }
  console.log('  ✓ expectSpan("test-operation") found span with input=21');

  // expectSpan(criteria) — match on name + attributes
  collector.expectSpan({ name: 'test-operation', attributes: { input: 21 } });
  console.log('  ✓ expectSpan({ name, attributes }) matched');

  // getSpansByName / getRootSpans / getDescendants for structure assertions.
  // Calling double() inside makes test-operation a child of parent-operation.
  const parent = instrument({
    key: 'parent-operation',
    fn: () => double(2),
  });
  parent();

  if (collector.getSpansByName('test-operation').length !== 2) {
    throw new Error('Expected two test-operation spans after second call');
  }
  const roots = collector.getRootSpans();
  if (!roots.some((s) => s.name === 'parent-operation')) {
    throw new Error('parent-operation should be a root span');
  }
  const parentSpan = collector.expectSpan('parent-operation');
  const children = collector.getDescendants(parentSpan.spanId);
  if (children.length !== 1 || children[0]!.name !== 'test-operation') {
    throw new Error('parent-operation should have one test-operation child');
  }
  console.log('  ✓ parent-operation → test-operation parent/child recorded');

  // For test runners, autotel-vitest builds on these primitives:
  //   test() wraps each test in an OTel span, step() adds child spans,
  //   assertNoErrors() verifies clean traces.
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
