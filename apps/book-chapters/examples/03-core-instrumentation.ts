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

  // 1. Reusable named function
  const getUser = trace('user.get', async (id: string) => ({
    id,
    name: 'Alice',
  }));
  const user = await getUser('123');
  console.log('  trace(name, fn) →', user);

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

  // 3. Explicit naming (same form as 1; second demo of stable names)
  const namedOp = trace(
    'process-payment',
    (amount: number) => `Paid $${amount}`,
  );
  console.log('  trace(name, fn) →', namedOp(100));

  // 4. span() runs a one-off inline span
  const computed = span('compute-value', () => 1 + 2 + 3);
  console.log('  span() →', computed);

  // 5. instrument({ key, fn }) is the options form; functions map wraps each key
  const keyed = instrument({
    key: 'keyed.double',
    fn: (x: number) => x * 2,
  });
  console.log('  instrument({ key, fn }) →', keyed(21));

  const mapped = instrument({ functions: { double: (x: number) => x * 2 } });
  console.log('  instrument({ functions }) →', mapped.double(21));

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
