import {
  init,
  trace,
  span,
  instrument,
  flush,
  shutdown,
  withTracing,
} from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 3: Core Instrumentation ===\n');

  init({
    service: 'book-03',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // 1. Direct trace wrapping
  const getUser = trace('user.get', async (id: string) => ({
    id,
    name: 'Alice',
  }));
  const user = await getUser('123');
  console.log('  trace(fn) →', user);

  // 2. Factory pattern with context access
  const createUser = withTracing({ name: 'user.create' })(
    (ctx) => async (data: { name: string }) => {
      ctx.setAttribute('user.name', data.name);
      ctx.setAttribute('user.id', Math.random().toString(36).slice(2));
      return { ...data, id: 'new-1' };
    },
  );
  const created = await createUser({ name: 'Bob' });
  console.log('  withTracing({})((ctx)=>fn) →', created);

  // 3. Explicit naming
  const namedOp = trace(
    'process-payment',
    (amount: number) => `Paid $${amount}`,
  );
  console.log('  trace(name, fn) →', namedOp(100));

  // 4. span() — inline span around any expression
  const computed = span('compute-value', () => 1 + 2 + 3);
  console.log('  span() →', computed);

  // 5. instrument() — explicit config (passes a functions map)
  const traced = instrument({ functions: { double: (x: number) => x * 2 } });
  console.log('  instrument() →', traced.double(21));

  await flush();
  const spans = exporter.getFinishedSpans();
  console.log(`\n  Spans created: ${spans.length}`);
  for (const s of spans) console.log(`    - "${s.name}"`);

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
