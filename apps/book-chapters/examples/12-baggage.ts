import { init, withBaggage, flush, shutdown, trace, ctx } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 12: Business Baggage ===\n');

  init({
    service: 'book-12',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Downstream service: reads baggage from context. No arguments were
  // passed between the services; the context carried the values.
  const serviceB = trace('service-b.handle', async () => {
    const tenantId = ctx.getBaggage('tenant.id');
    const userId = ctx.getBaggage('user.id');
    if (!tenantId || !userId) {
      throw new Error('Baggage did not propagate to service-b');
    }
    ctx.setAttribute('tenant.id', tenantId);
    ctx.setAttribute('user.id', userId);
    console.log(
      `  service-b read baggage: tenant.id=${tenantId}, user.id=${userId}`,
    );
  });

  // Upstream service: sets baggage, then calls downstream inside fn.
  const serviceA = trace('service-a.handle', async () => {
    ctx.setAttribute('service', 'auth-service');
    await withBaggage({
      baggage: {
        'tenant.id': 'tenant_acme',
        'user.id': 'user_42',
      },
      fn: async () => {
        console.log('  service-a set baggage: tenant.id=tenant_acme');
        await serviceB();
      },
    });
  });

  await serviceA();
  await flush();

  const spans = exporter.getFinishedSpans();
  const spanB = spans.find((s) => s.name === 'service-b.handle');
  if (!spanB) throw new Error('service-b.handle span was not exported');
  if (spanB.attributes['tenant.id'] !== 'tenant_acme') {
    throw new Error(
      `service-b span should carry tenant.id from baggage, got: ${String(spanB.attributes['tenant.id'])}`,
    );
  }
  if (spanB.attributes['user.id'] !== 'user_42') {
    throw new Error(
      `service-b span should carry user.id from baggage, got: ${String(spanB.attributes['user.id'])}`,
    );
  }
  console.log('\n  ✓ service-b span attributes sourced from baggage');
  console.log(`  Spans created: ${spans.length}`);
  for (const s of spans) console.log(`    - "${s.name}"`);

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
