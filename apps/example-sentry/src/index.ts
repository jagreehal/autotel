/**
 * Example: Autotel + Sentry via OTLP
 *
 * Demonstrates:
 * - sentryOtlpConfig() builds OTLP endpoint/headers from DSN
 * - Autotel exports traces and pino logs to Sentry's OTLP endpoint
 * - Captured errors land on the active trace
 *
 * Run: pnpm start
 * Run with error: THROW_FOR_DEMO=1 pnpm start
 */

import './telemetry'; // first: runs init() before pino loads
import * as Sentry from '@sentry/node';
import { shutdown, span, getActiveTraceContext } from 'autotel';
import { log } from './logger';

async function main() {
  await span('example-sentry-demo', async () => {
    const ctx = getActiveTraceContext()!;
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
