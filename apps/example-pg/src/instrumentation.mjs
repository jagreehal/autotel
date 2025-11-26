/**
 * Instrumentation file - loaded BEFORE the main app
 *
 * This file sets up OpenTelemetry instrumentation before any other
 * modules are imported, allowing the instrumentation to intercept
 * module loading and patch the pg library.
 *
 * Run with: node --import ./src/instrumentation.mjs src/index.ts
 * Or with tsx: tsx --import ./src/instrumentation.mjs src/index.ts
 */

import 'dotenv/config';
import { init } from 'autotel';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

console.log('🔧 Loading instrumentation...');

init({
  service: 'example-pg',
  debug: true,
  instrumentations: [
    new PgInstrumentation({
      enhancedDatabaseReporting: true,
    }),
  ],
});

console.log('✅ Instrumentation initialized\n');
