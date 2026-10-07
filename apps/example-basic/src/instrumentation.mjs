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

console.log('🔧 Initializing autotel with pino instrumentation...');

init({
  service: 'example-pino-esm',
  debug: true,
  // Only pino loads (needs @opentelemetry/auto-instrumentations-node installed)
  autoInstrumentations: ['pino'],
});

console.log('✅ Autotel initialized\n');
