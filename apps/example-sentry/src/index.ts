/**
 * Example: Autotel + Sentry via OTLP
 *
 * Demonstrates:
 * - sentryOtlpConfig() builds OTLP endpoint/headers from DSN
 * - linkSentryErrors() links Sentry errors to active OTel traces
 * - Autotel exports traces directly to Sentry's OTLP endpoint
 *
 * Run: pnpm start
 * Run with error: THROW_FOR_DEMO=1 pnpm start
 */

import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { init, shutdown, span, trace } from 'autotel';
import { createBuiltinLogger } from 'autotel/logger';
import { linkSentryErrors, sentryOtlpConfig } from 'autotel-sentry';

// Build OTLP config from DSN — extracts endpoint and auth headers.
const config = sentryOtlpConfig(process.env.SENTRY_DSN!);
const log = createBuiltinLogger('example-sentry');

// Sentry handles errors only — let Autotel own the OTel setup.
Sentry.init({
  dsn: config.dsn,
  skipOpenTelemetrySetup: true,
});

// Autotel exports traces via OTLP directly to Sentry.
init({
  service: 'example-sentry',
  endpoint: config.endpoint,
  headers: config.headers,
  logs: true,
  debug: !!process.env.AUTOTEL_DEBUG,
});

// Link Sentry errors to active OTel traces.
linkSentryErrors(Sentry);

async function main() {
  await trace('example-sentry-demo', async (ctx) => {
    ctx.setAttribute('demo', true);
    log.info({ demo: true }, 'trace started');

    // Simulate work with a child span.
    await span('fetch-data', async (child) => {
      child.setAttribute('source', 'mock-api');
      await new Promise((r) => setTimeout(r, 50));
      log.info({ source: 'mock-api' }, 'data fetched');
    });

    // Optionally capture an error linked to the current trace.
    if (process.env.THROW_FOR_DEMO === '1') {
      Sentry.captureException(new Error('Demo error for Sentry'));
      ctx.setStatus({ code: 2 });
    }

    log.info({ demo: true }, 'trace finished');
  });

  await Sentry.flush(5000);
  await shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
