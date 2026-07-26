import { init, flush, shutdown } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { traceHTTP } from 'autotel/semantic-helpers';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 14: HTTP Instrumentation ===\n');

  init({
    service: 'book-14',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // traceHTTP uses (ctx) => fn pattern with HTTP semantic conventions
  traceHTTP({
    method: 'POST',
    url: '/api/checkout',
    route: '/api/checkout',
  })((ctx) => () => {
    ctx.setAttribute('http.route', '/api/checkout');
    ctx.setAttribute('http.request.body.size', 1024);
    console.log('  ✓ HTTP span for POST /api/checkout');
  })();

  traceHTTP({
    method: 'GET',
    url: 'https://api.example.com/users',
    urlTemplate: 'https://api.example.com/users',
  })((ctx) => () => {
    ctx.setAttribute('http.response.body.size', 512);
    console.log('  ✓ HTTP span for GET https://api.example.com/users');
  })();

  await flush();
  const spans = exporter.getFinishedSpans();
  if (spans.some((span) => span.name === 'unknown')) {
    throw new Error('HTTP semantic helpers must not emit unknown span names');
  }
  console.log(`\n  Spans created: ${spans.length}`);
  for (const s of spans) console.log(`    - "${s.name}"`);

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
