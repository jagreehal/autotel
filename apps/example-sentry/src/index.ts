/**
 * Example: Autotel + Sentry OpenTelemetry bridge
 *
 * Prerequisites:
 * - Set SENTRY_DSN in .env (or pass as env var) to send events to Sentry.
 * - Sentry must be initialized before Autotel init.
 *
 * Run: pnpm start
 *
 * This will create a trace and optionally record an error so you can verify
 * in Sentry that the trace and error are linked (same trace/span IDs).
 */

import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { init, trace, shutdown } from 'autotel';
import { createSentrySpanProcessor } from 'autotel-sentry';

// 1. Initialize Sentry first (before OTel / Autotel)
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  instrumenter: 'otel',
});

// 2. Initialize Autotel with Sentry span processor
init({
  service: 'example-sentry',
  spanProcessors: [createSentrySpanProcessor(Sentry)],
  debug: !!process.env.AUTOTEL_DEBUG,
});

async function main() {
  await trace('example-sentry-demo', async (ctx) => {
    ctx.setAttribute('demo', true);
    await new Promise((r) => setTimeout(r, 50));
    // Optionally record an exception so Sentry shows error + trace
    if (process.env.SENTRY_DSN && process.env.THROW_FOR_DEMO === '1') {
      ctx.recordException(new Error('Demo error for Sentry'));
      ctx.setStatus({ code: 2 });
    }
  });

  await shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
