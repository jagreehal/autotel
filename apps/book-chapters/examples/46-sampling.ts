import {
  init,
  flush,
  shutdown,
  AttributeRedactingProcessor,
  forceKeep,
  trace,
  ctx,
} from 'autotel';
import { AdaptiveSampler } from 'autotel/sampling';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 46: Sampling & PII Redaction ===\n');

  // AdaptiveSampler: sample a fraction of normal traffic, keep every
  // error and every slow request. Demo rate 1.0 so the span always exports.
  const sampler = new AdaptiveSampler({
    baselineSampleRate: 1.0, // production: ~0.1
    alwaysSampleErrors: true,
    slowThresholdMs: 1000,
  });

  // AttributeRedactingProcessor wraps any processor and scrubs PII from
  // finished spans. Presets: 'default' | 'strict' | 'pci-dss'.
  const redacting = new AttributeRedactingProcessor(
    new SimpleSpanProcessor(exporter),
    { redactor: 'default' },
  );

  init({ service: 'book-46', sampler, spanProcessors: [redacting] });

  const lookupUser = trace('user.lookup', (email: string) => {
    // Keep this span whatever the baseline roll decides (payments, audits).
    forceKeep();
    ctx.setAttribute('user.email', email);
    ctx.setAttribute('payment.card', '4111 1111 1111 1111');
    ctx.setAttribute('user.plan', 'premium');
    return 'found';
  });
  lookupUser('alice@example.com');

  await flush();
  const spans = exporter.getFinishedSpans();
  console.log(`  Spans exported: ${spans.length}`);
  const attrs = spans[0]?.attributes ?? {};
  for (const key of ['user.email', 'payment.card', 'user.plan'] as const) {
    console.log(`    ${key}: ${attrs[key]}`);
  }

  // Prove the redactor scrubbed the PII before export
  if (String(attrs['user.email']).includes('alice@example.com')) {
    throw new Error('Email was exported unredacted');
  }
  if (String(attrs['payment.card']).includes('4111')) {
    throw new Error('Card number was exported unredacted');
  }
  if (attrs['user.plan'] !== 'premium') {
    throw new Error('Non-PII attribute should pass through untouched');
  }
  if (attrs['autotel.sampling.tail.keep'] !== true) {
    throw new Error('forceKeep() should mark the span for tail keep');
  }
  console.log('\n✓ PII redacted at export; non-PII attributes untouched');
  console.log('✓ forceKeep() marked autotel.sampling.tail.keep');
  console.log('✓ AdaptiveSampler installed via init({ sampler })');

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
