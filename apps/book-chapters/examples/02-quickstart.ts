import { init, trace, span, flush, shutdown } from 'autotel';
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

  // trace(fn) wraps your function with a span automatically
  const hello = trace('hello', () => {
    return 'Hello, observability!';
  });
  console.log('  ', hello());

  // trace(name, fn) for explicit naming
  const named = trace('my-named-span', () => 'named result');
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
