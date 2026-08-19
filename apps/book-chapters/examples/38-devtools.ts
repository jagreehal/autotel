import { init, instrument, flush, shutdown } from 'autotel';
import { SimpleSpanProcessor } from 'autotel/processors';
import { createDevtools } from 'autotel-devtools';

async function main() {
  console.log('=== Chapter 38: DevTools ===\n');

  // createDevtools() starts a local receiver + web UI and hands back an
  // exporter. In day-to-day dev you skip all of this and just write
  // init({ devtools: true }) — shown manually here so the wiring is visible.
  const devtools = createDevtools({ port: 4381 });
  console.log(
    `  ✓ Devtools receiver listening on http://127.0.0.1:${devtools.port}`,
  );

  init({
    service: 'book-38',
    spanProcessors: [new SimpleSpanProcessor(devtools.exporter)],
  });

  const greet = instrument({
    key: 'greet',
    fn: (name: string) => `Hello, ${name}!`,
  });
  console.log(`  ✓ Traced call → ${greet('devtools')}`);

  await flush();
  console.log('  ✓ Span streamed to the devtools UI (traces view)');

  await shutdown();
  await devtools.close();
  console.log('\n✓ createDevtools() → exporter → web UI round trip');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
