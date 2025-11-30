/**
 * ESM Instrumentation file - loaded BEFORE the main app
 *
 * For ESM apps, you need:
 * 1. import 'autotel/register' FIRST (registers ESM loader hooks)
 * 2. Pass instrumentations directly to init()
 *
 * Run with: tsx --import ./src/instrumentation.mjs src/test-pino-esm.ts
 */

// MUST be first import to register ESM hooks!
import 'autotel/register';

import 'dotenv/config';
import { init } from 'autotel';

// For ESM, import the specific instrumentation you need
// This is included in @opentelemetry/auto-instrumentations-node
// Install: pnpm add @opentelemetry/auto-instrumentations-node
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

console.log('🔧 Initializing autotel with pino instrumentation...');

init({
  service: 'example-pino-esm',
  debug: true,
  // Use getNodeAutoInstrumentations with specific config
  instrumentations: getNodeAutoInstrumentations({
    // Enable only pino (disable everything else for minimal overhead)
    '@opentelemetry/instrumentation-pino': { enabled: true },
  }),
});

console.log('✅ Autotel initialized\n');
