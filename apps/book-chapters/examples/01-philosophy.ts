import {
  init,
  instrument,
  getRequestLogger,
  createStructuredError,
  parseError,
  flush,
  shutdown,
  withTracing,
} from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 1: Philosophy & Architecture ===\n');

  init({
    service: 'book-01',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Functional API
  const greet = instrument({
    key: 'greeting.create',
    fn: (name: string) => `Hello, ${name}!`,
  });
  console.log('  instrument({ key, fn }) →', greet('Autotel'));

  // Factory pattern with context
  const greetWithCtx = withTracing({ name: 'greeting.contextual' })(
    (ctx) => (name: string) => {
      ctx.setAttribute('greeting.name', name);
      return `Hi, ${name}!`;
    },
  );
  console.log('  withTracing({})((ctx) => fn) →', greetWithCtx('Reader'));

  // Structured errors
  try {
    throw createStructuredError({
      message: 'User not found',
      status: 404,
      why: 'No user exists',
      fix: 'Check the ID',
    });
  } catch (e) {
    const parsed = parseError(e);
    console.log(
      '  Structured error →',
      parsed.message,
      '/ why:',
      parsed.why,
      '/ fix:',
      parsed.fix,
      '/ status:',
      parsed.status,
    );
  }

  // Request logger
  const handler = withTracing({ name: 'request.handle' })(
    (ctx) => async (reqName: string) => {
      const log = getRequestLogger(ctx);
      log.set({ request: reqName });
      log.info('Processing');
      log.set({ result: 'done' });
      log.emitNow();
      return 'ok';
    },
  );
  await handler('test-req');

  await flush();
  const spans = exporter.getFinishedSpans();
  console.log(`\n  Spans recorded: ${spans.length}`);
  for (const s of spans) console.log(`    - "${s.name}"`);

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
