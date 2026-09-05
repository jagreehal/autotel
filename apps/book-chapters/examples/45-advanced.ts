import { init, flush, shutdown, trace, ctx } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import {
  createDeterministicTraceId,
  flattenMetadata,
} from 'autotel/trace-helpers';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 45: Advanced Features ===\n');

  init({
    service: 'book-45',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // 1. Deterministic trace IDs: same seed → same 128-bit ID
  const traceId = await createDeterministicTraceId('order_456');
  console.log(
    '  Deterministic trace ID from "order_456":',
    traceId.slice(0, 20) + '...',
  );

  const sameTraceId = await createDeterministicTraceId('order_456');
  if (traceId !== sameTraceId) {
    throw new Error('Same seed must produce the same trace ID');
  }
  console.log('  ✓ Same seed produces same ID');

  // 2. Metadata flattening: nested objects → "metadata." dot-notation keys
  const handler = trace('metadata.flatten', () => {
    ctx.setAttributes(
      flattenMetadata({
        user: { id: '42', tier: 'premium' },
        payment: { method: 'card', processor: 'stripe' },
        items: 3,
      }),
    );
  });
  handler();

  await flush();
  const spans = exporter.getFinishedSpans();
  const span = spans.find((s) => s.name === 'metadata.flatten');
  if (!span) throw new Error('metadata.flatten span was not exported');

  const expectedKeys = [
    'metadata.user.id',
    'metadata.user.tier',
    'metadata.payment.method',
    'metadata.payment.processor',
    'metadata.items',
  ];
  for (const key of expectedKeys) {
    if (!(key in span.attributes)) {
      throw new Error(`Expected flattened attribute "${key}" on span`);
    }
  }
  console.log('  ✓ flattenMetadata dot-notation keys exported:');
  for (const key of expectedKeys) {
    console.log(`      ${key}: ${span.attributes[key]}`);
  }

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
