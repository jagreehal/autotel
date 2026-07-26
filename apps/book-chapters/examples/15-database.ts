import { init, flush, shutdown } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { traceDB } from 'autotel/semantic-helpers';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 15: Database Instrumentation ===\n');

  init({
    service: 'book-15',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // traceDB uses (ctx) => fn pattern with DB semantic conventions
  traceDB({
    system: 'postgresql',
    operation: 'SELECT',
    database: 'book',
    collection: 'users',
  })((ctx) => (id: string) => {
    ctx.setAttribute('db.collection.name', 'users');
    ctx.setAttribute('db.operation.name', 'SELECT');
    console.log('  ✓ DB span — SELECT from users');
    return { id, name: 'Alice' };
  })('42');

  traceDB({
    system: 'postgresql',
    operation: 'INSERT',
    database: 'book',
    collection: 'orders',
  })((ctx) => () => {
    ctx.setAttribute('db.collection.name', 'orders');
    ctx.setAttribute('db.operation.name', 'INSERT');
    console.log('  ✓ DB span — INSERT into orders');
  })();

  console.log('\n  Database packages also available:');
  console.log('    autotel-drizzle  — instrumentDrizzle()');
  console.log(
    '    autotel-mongoose — instrumentMongoose() (with PII redaction)',
  );

  await flush();
  const spans = exporter.getFinishedSpans();
  if (spans.some((span) => span.name === 'unknown')) {
    throw new Error(
      'Database semantic helpers must not emit unknown span names',
    );
  }
  console.log(`\n  Spans created: ${spans.length}`);
  for (const s of spans) console.log(`    - "${s.name}"`);

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
