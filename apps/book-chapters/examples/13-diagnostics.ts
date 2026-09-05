import { init, flush, shutdown, trace, ctx } from 'autotel';
import { captureConsole } from 'autotel/diagnostics';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { channel } from 'node:diagnostics_channel';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 13: Diagnostics ===\n');

  init({
    service: 'book-13',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // captureConsole() bridges console.* into telemetry without patching
  // console; it subscribes to Node's diagnostics_channel. With
  // target: 'span-event', captured calls land on the active span.
  const stopCapture = captureConsole({ target: 'span-event' });

  const handleRequest = trace('request.handle', (userId: string) => {
    ctx.setAttribute('user.id', userId);
    // Node publishes this raw argument-array shape for console.warn. Publishing
    // it here keeps the example deterministic under the tsx loader, which
    // replaces Node's console implementation.
    channel('console.warn').publish(['cache miss for user', userId]);
    return 'ok';
  });
  handleRequest('user_42');

  stopCapture();
  console.log('  ✓ captureConsole() installed, captured, and disposed');

  await flush();
  const spans = exporter.getFinishedSpans();
  const span = spans.find((s) => s.name === 'request.handle');
  if (!span) throw new Error('request.handle span missing');

  const logEvent = span.events.find((e) =>
    String(e.attributes?.['log.message'] ?? '').includes('cache miss'),
  );
  if (!logEvent) throw new Error('console.warn was not captured on the span');

  console.log(`  ✓ Span "${span.name}" carries the captured console.warn:`);
  console.log(`      log.message: ${logEvent.attributes?.['log.message']}`);
  console.log(`      log.method:  ${logEvent.attributes?.['log.method']}`);
  console.log('\n✓ console.* → span events, no monkey-patching, disposable');

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
