/**
 * CJS test for Pino instrumentation with trace context injection
 *
 * Run with: node --require ./src/instrumentation.cjs src/test-pino-cjs.cjs
 */

const { instrument, shutdown, flush } = require('autotel');
const pino = require('pino');

// Create a synchronous destination for immediate output
const dest = pino.destination({ sync: true });
const logger = pino({ name: 'pino-cjs-test' }, dest);

console.log('📝 Log OUTSIDE trace (no trace_id expected):');
logger.info('Outside trace - should NOT have trace_id');
dest.flushSync();

console.log('');
console.log('📝 Log INSIDE trace (SHOULD have trace_id):');

// Create traced function
const tracedOperation = instrument({
  key: 'cjs-test-operation',
  fn: async () => {
    logger.info('Inside trace - SHOULD have trace_id!');
    logger.info(
      { userId: '123', action: 'test' },
      'Structured log inside trace',
    );
    dest.flushSync();
    return 'success';
  },
});

async function main() {
  const result = await tracedOperation();

  // Flush autotel traces
  await flush();

  console.log('');
  console.log('Result:', result);
  console.log('');
  console.log('✅ Test complete - check logs above for trace_id field');

  await shutdown();
  process.exit(0);
}

main().catch(console.error);
