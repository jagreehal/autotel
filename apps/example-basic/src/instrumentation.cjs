/**
 * CJS Instrumentation file - loaded BEFORE the main app
 *
 * For CJS apps, simply require this file first with --require flag.
 * No special loader hooks needed!
 *
 * Run with: node --require ./src/instrumentation.cjs src/test-pino-cjs.cjs
 */

require('dotenv/config');
const { init } = require('autotel');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

console.log('🔧 Initializing autotel with pino instrumentation (CJS)...');

init({
  service: 'example-pino-cjs',
  debug: true,
  instrumentations: getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-pino': { enabled: true },
  }),
});

console.log('✅ Autotel initialized\n');
