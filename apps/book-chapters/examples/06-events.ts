import { init, track, flush, shutdown } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 6: Events & Product Analytics ===\n');

  init({
    service: 'book-06',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // track() — fire-and-forget product/analytics events
  track('user.signed_up', {
    'user.id': 'user_42',
    'user.tier': 'premium',
    'signup.source': 'referral',
  });
  console.log('  ✓ track() — user.signed_up');

  track('order.placed', {
    'order.id': 'ord_123',
    'order.total': 2999,
    'order.currency': 'USD',
    'order.items': 3,
  });
  console.log('  ✓ track() — order.placed');

  track('payment.completed', {
    'payment.method': 'card',
    'payment.amount': 2999,
    'payment.status': 'success',
  });
  console.log('  ✓ track() — payment.completed');

  await flush();
  const spans = exporter.getFinishedSpans();
  console.log(`\n  Spans during event emission: ${spans.length}`);

  await shutdown();
  console.log(
    '\n✓ Events emitted. Events are queued asynchronously and processed by subscribers.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
