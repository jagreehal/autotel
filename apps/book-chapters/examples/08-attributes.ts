import {
  init,
  attrs,
  setUser,
  safeSetAttributes,
  flush,
  shutdown,
  withTracing,
} from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 8: Attributes & Semantic Conventions ===\n');

  init({
    service: 'book-08',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const demo = withTracing({ name: 'attributes.demo' })((ctx) => () => {
    // 1. Key builders — one attribute, semconv-correct key, typed value
    ctx.setAttributes(attrs.user.id('user_42'));
    ctx.setAttributes(attrs.session.id('sess_123'));

    // 2. Object builder — many user.* attributes in one call
    safeSetAttributes(
      ctx,
      attrs.user.data({ name: 'Alice', roles: ['admin'] }),
    );

    // 3. Attacher — builds AND safely sets in one call
    setUser(ctx, { hash: 'u_9f8e7d6c' });

    // 4. Guardrails — PII policy applied before values hit the span
    safeSetAttributes(
      ctx,
      { 'user.email': 'alice@example.com' },
      { guardrails: { pii: 'redact' } },
    );
  });
  demo();

  await flush();
  const spans = exporter.getFinishedSpans();
  const span = spans.find((s) => s.name === 'attributes.demo');
  if (!span) throw new Error('attributes.demo span was not exported');

  const expectedKeys = [
    'user.id',
    'session.id',
    'user.name',
    'user.roles',
    'user.hash',
    'user.email',
  ];
  for (const key of expectedKeys) {
    if (!(key in span.attributes)) {
      throw new Error(`Expected attribute "${key}" on span, missing`);
    }
  }

  // The PII guardrail redacted the email before it reached the exporter
  if (span.attributes['user.email'] !== '[REDACTED]') {
    throw new Error(
      `Expected user.email to be redacted, got: ${String(span.attributes['user.email'])}`,
    );
  }

  console.log(`  Span: "${span.name}"`);
  for (const [k, v] of Object.entries(span.attributes)) {
    console.log(`    ${k}: ${v}`);
  }
  console.log('\n  ✓ All builder attributes exported');
  console.log(
    `  ✓ PII guardrail: user.email → ${String(span.attributes['user.email'])}`,
  );

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
