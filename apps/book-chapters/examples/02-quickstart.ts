import { init, instrument, span, flush, shutdown } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 2: Quickstart ===\n');

  // init() — one synchronous call to set everything up
  init({
    service: 'book-02-quickstart',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  console.log('✓ init() sets up the OTel SDK');

  // instrument({ key, fn }) wraps a reusable function with a stable span name
  const hello = instrument({
    key: 'hello',
    fn: () => {
      return 'Hello, observability!';
    },
  });
  console.log('  ', hello());

  const named = instrument({
    key: 'my-named-span',
    fn: () => 'named result',
  });
  console.log('  ', named());
  const result = span('inline-work', () => 42);
  console.log('  span() result:', result);

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
