import { init, getRequestLogger, flush, shutdown, withTracing } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 4: Request Context — getRequestLogger() ===\n');

  init({
    service: 'book-04',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Before: scattered console.log
  // console.log('Request started');
  // console.log('User:', user.id);
  // console.log('Order:', orderId);

  // After: one coherent snapshot per request

  const handleCheckout = withTracing({ name: 'checkout.handle' })(
    (ctx) => async (userId: string, cartItems: number) => {
      const log = getRequestLogger(ctx);

      log.set({ user: { id: userId }, cart: { items: cartItems } });
      log.info('Checkout started');

      // Simulate work
      const orderId = `ord_${Math.random().toString(36).slice(2)}`;
      log.set({ order: { id: orderId } });
      log.info('Order created');

      log.emitNow();
      return { orderId };
    },
  );

  await handleCheckout('user_42', 3);
  await flush();

  const spans = exporter.getFinishedSpans();
  console.log(`  Spans created: ${spans.length}`);
  for (const s of spans) {
    console.log(`    - "${s.name}"`);
    if (Object.keys(s.attributes).length)
      console.log('      attrs:', s.attributes);
  }

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
