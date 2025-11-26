/**
 * Basic example demonstrating autotel
 * 
 * This example shows:
 * - Basic tracing with trace()
 * - Metrics tracking
 * - Events events
 * - Custom attributes
 * 
 * Run: pnpm start
 */

import pino from 'pino';

// Use pino directly - just add the mixin for trace context
const logger = pino({
  name: 'example',
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
 
});

import 'dotenv/config';
import { init, trace, Metric, track, shutdown, span, SpanStatusCode, createCounter, getMeter } from 'autotel';

// Initialize autotel
init({
  service: 'example-service',
  // OTLP endpoint - defaults to Jaeger All-in-one (http://localhost:4318)
  // Override via OTLP_ENDPOINT env var for other backends (Grafana, Datadog, etc.)
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  version: process.env.APP_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  logger,
  // Optional: enable Node auto-instrumentations whenever the dependency is installed.
  // Run: pnpm add -D @opentelemetry/auto-instrumentations-node
  integrations:
    process.env.ENABLE_AUTO_INSTRUMENTATIONS === 'true'
      ? ['http', 'express']
      : undefined,
});

// Create a metrics instance
const metrics = new Metric('example');
const rollCounter = createCounter('example.roll.once', {
  description: 'Count of dice roll attempts',
  unit: '1',
});

const meter = getMeter();



// Option 1: Named function - automatically infers name "increment"
const increment = trace(async function increment() {   
  logger.info({'event': 'increment', 'value': 1});
  track('increment', { value: 1 });
  // Create nested span for metrics tracking (like startActiveSpan)
  await span({ 
    name: 'metrics.trackEvent',
    attributes: { 'event.name': 'increment', 'event.value': 1 }
  }, async (span) => {
    metrics.trackEvent('increment', { value: 1 });
  });

  
  await new Promise(resolve => setTimeout(resolve, 100));
});

export const rollOnce = function rollOnce({ i, min, max }: { i: number, min: number, max: number }): number {
  // span() supports sync functions - no await needed!
  return span({ name: `rollOnce.${i}` }, (span) => {
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    span.setAttribute('result', result);
    span.setAttribute('min', min);
    span.setAttribute('max', max);
    span.addEvent('rollOnce', { result });
    span.setStatus({ code: SpanStatusCode.OK });
    rollCounter.add(1, { result });
    return result;
  });
};

export const rollTheDice = trace(function rollTheDice({rolls, min, max}: {rolls: number, min: number, max: number}): number[] {
  // span() supports sync functions - no await needed!
  return span({ name: 'rollTheDice' }, (span) => {
    span.setAttribute('rolls', rolls);
    span.setAttribute('min', min);
    span.setAttribute('max', max);
    
    const result: number[] = [];
    for (let i = 0; i < rolls; i++) {
      const roll = rollOnce({ i, min, max });
      result.push(roll);
    }
    return result;
  });
});


// Option 2: With trace context (to add attributes, set status, etc.)
// const increment = trace((ctx) => async () => {
//   ctx.setAttribute('operation', 'increment');
//   logger.info('Incrementing');
//   await new Promise(resolve => setTimeout(resolve, 100));
//   ctx.setStatus({ code: 1 }); // OK
// });

// Option 3: Custom span name
// const increment = trace('counter.increment', async () => {
//   logger.info('Incrementing');
//   await new Promise(resolve => setTimeout(resolve, 100));
// });

// Main function to run examples 
async function main() {
  console.log('🚀 Starting autotel example...\n');

  // Call the traced function
  await increment;
  logger.info('Increment completed');
  
  // Test rollTheDice (sync function - no await needed!)
  const histogram = meter.createHistogram('example.roll.once', {
    description: 'Histogram of dice roll attempts',
    unit: '1',
  });
  
  const diceResult = rollTheDice({ rolls: 3, min: 1, max: 6 });
  histogram.record(diceResult.reduce((acc, curr) => acc + curr, 0));
  logger.info({ diceResult }, 'Dice rolled');
  
  // Wait a bit for traces to be exported
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Gracefully shutdown - flushes all pending telemetry
  await shutdown();
  process.exit(0);
}

main().catch(console.error);
