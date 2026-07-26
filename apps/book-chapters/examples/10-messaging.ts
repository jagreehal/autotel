import { init, flush, shutdown } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { traceProducer, traceConsumer } from 'autotel/messaging';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 10: Messaging ===\n');

  init({
    service: 'book-10',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const sendOrder = traceProducer({
    system: 'kafka',
    destination: 'orders',
  })(() => async (orderId: string) => {
    console.log(`  ✓ Message ${orderId} produced to topic "orders"`);
    return 'sent';
  });
  console.log('  Producer result:', await sendOrder('ord_123'));

  const processOrder = traceConsumer({
    system: 'kafka',
    destination: 'orders',
  })(() => async (orderId: string) => {
    console.log(`  ✓ Message ${orderId} consumed from topic "orders"`);
    return 'processed';
  });
  console.log('  Consumer result:', await processOrder('ord_123'));

  await flush();
  const spans = exporter.getFinishedSpans();
  const names = spans.map((span) => span.name);
  if (!names.includes('publish orders') || !names.includes('process orders')) {
    throw new Error(`Unexpected messaging span names: ${names.join(', ')}`);
  }
  console.log(`\n  Spans created: ${spans.length}`);
  for (const s of spans) console.log(`    - "${s.name}"`);

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
