/**
 * DEBUG VERSION - Datadog + Autotel Integration Example
 *
 * This is a temporary debug version that routes through the debug proxy.
 * Use this to see exactly what's being sent to Datadog.
 *
 * Steps:
 * 1. Terminal 1: pnpm debug-proxy
 * 2. Terminal 2: tsx src/index-debug.ts
 * 3. Watch Terminal 1 for detailed request/response logs
 */

import 'dotenv/config';
import { init, trace, shutdown, Metric, type TraceContext } from 'autotel';
import { createLogger, LOG_LEVEL, type LogLevel } from 'autotel/logger';
import { type DatadogSite } from 'autotel/presets/datadog';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CURRENCY = 'USD';
const SIMULATION_DELAYS = {
  ORDER_PROCESSING: 100,
  PAYMENT_VALIDATION: 50,
  CARD_CHARGING: 150,
  REFUND_PROCESSING: 80,
  REPORT_GENERATION: 200,
} as const;

const REFUND_FAILURE_PROBABILITY = 0.3; // 30% chance of failure

// ============================================================================
// Configuration
// ============================================================================

interface AppConfig {
  apiKey: string;
  site: DatadogSite;
  service: string;
  environment: string;
  version?: string;
  logLevel: LogLevel;
  enableLogExport: boolean;
}

function loadConfig(): AppConfig {
  const apiKey = process.env.DATADOG_API_KEY;

  if (!apiKey) {
    console.error('❌ Error: DATADOG_API_KEY environment variable is required');
    console.error('   Copy .env.example to .env and add your API key');
    console.error('   Get your key from: https://app.datadoghq.com/organization-settings/api-keys');
    process.exit(1);
  }

  return {
    apiKey,
    site: (process.env.DATADOG_SITE || 'datadoghq.com') as DatadogSite,
    service: process.env.SERVICE_NAME || 'example-datadog',
    environment: process.env.ENVIRONMENT || 'development',
    version: process.env.VERSION,
    logLevel: (process.env.LOG_LEVEL as LogLevel) ?? LOG_LEVEL.INFO,
    enableLogExport: process.env.ENABLE_LOG_EXPORT !== 'false',
  };
}

const config = loadConfig();

console.log('🔧 DEBUG Configuration:');
console.log(`   Service: ${config.service}`);
console.log(`   Environment: ${config.environment}`);
console.log(`   Datadog Site: ${config.site}`);
console.log(`   🔍 Using Debug Proxy: http://localhost:8080`);
console.log(`   ↳ Proxy will forward to: https://otlp.${config.site}`);
console.log('');

// ============================================================================
// Utility Functions
// ============================================================================

/** Simulate async delay (e.g., API calls, processing time) */
const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/** Simulate random failures for testing error handling */
const shouldSimulateFailure = (probability: number): boolean =>
  Math.random() > (1 - probability);

// ============================================================================
// Initialize Autotel with Debug Proxy
// ============================================================================

// Create logger first
const logger = createLogger('datadog-debug', {
  level: config.logLevel,
  pretty: config.environment !== 'production',
});

// IMPORTANT: Using debug proxy instead of direct Datadog connection
// This allows us to see exactly what's being sent
init({
  service: config.service,
  environment: config.environment,
  version: config.version,
  endpoint: 'http://localhost:8080', // Debug proxy
  otlpHeaders: `dd-api-key=${config.apiKey}`, // Still include API key
  // Note: Log export omitted for simplicity in debugging
});

logger.info('✅ Autotel initialized with DEBUG PROXY');
logger.info('   All telemetry will be logged by the proxy before forwarding to Datadog');

// Create metrics instance for tracking business metrics
const metrics = new Metric('datadog-debug', { logger });

// ============================================================================
// Example Functions with Tracing
// ============================================================================

/**
 * Simple traced function for testing
 */
const processOrder = trace((ctx: TraceContext) => async function processOrder(orderId: string, amount: number) {
  logger.info('Processing order', { orderId, amount });

  // Add custom attributes to the trace
  ctx.setAttribute('order.id', orderId);
  ctx.setAttribute('order.amount', amount);
  ctx.setAttribute('order.currency', DEFAULT_CURRENCY);

  // Simulate processing
  await delay(SIMULATION_DELAYS.ORDER_PROCESSING);

  // Track business metric
  metrics.trackEvent('order.processed', {
    currency: DEFAULT_CURRENCY,
    environment: config.environment,
  });

  logger.info('Order processed successfully', { orderId, traceId: ctx.traceId });

  return { orderId, status: 'completed' as const, amount };
});

const validatePayment = trace((ctx: TraceContext) => async function validatePayment(orderId: string, amount: number) {
  logger.info('Validating payment', { orderId });

  ctx.setAttribute('payment.amount', amount);

  await delay(SIMULATION_DELAYS.PAYMENT_VALIDATION);

  if (amount < 0) {
    throw new Error('Invalid payment amount');
  }

  return { valid: true };
});

const chargeCard = trace((ctx: TraceContext) => async function chargeCard(orderId: string) {
  logger.info('Charging card', { orderId });

  ctx.setAttribute('payment.method', 'credit_card');

  await delay(SIMULATION_DELAYS.CARD_CHARGING);

  return { transactionId: `txn_${Date.now()}` };
});

const processPayment = trace((ctx: TraceContext) => async function processPayment(orderId: string, amount: number) {
  logger.info('Processing payment', { orderId, amount });

  ctx.setAttribute('order.id', orderId);
  ctx.setAttribute('payment.amount', amount);

  await validatePayment(orderId, amount);
  const charge = await chargeCard(orderId);

  logger.info('Payment completed', { orderId, transactionId: charge.transactionId });

  return charge;
});

const processRefund = trace((ctx: TraceContext) => async function processRefund(orderId: string) {
  logger.info('Processing refund', { orderId });

  ctx.setAttribute('refund.order_id', orderId);

  if (shouldSimulateFailure(REFUND_FAILURE_PROBABILITY)) {
    const error = new Error('Refund failed: insufficient funds');
    logger.error('Refund failed: insufficient funds', error, { orderId });
    throw error;
  }

  await delay(SIMULATION_DELAYS.REFUND_PROCESSING);

  logger.info('Refund processed successfully', { orderId });

  return { orderId, status: 'refunded' as const };
});

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log('🚀 Starting DEBUG version of Datadog integration examples...\n');
  console.log('👁️  Watch the debug proxy terminal for detailed request/response logs\n');

  try {
    // Just run a simple test to generate some telemetry
    console.log('📦 Processing test order');
    const order = await processOrder('DEBUG-001', 99.99);
    console.log(`   ✅ Processed ${order.orderId}\n`);

    console.log('💳 Processing payment');
    const payment = await processPayment('DEBUG-001', 99.99);
    console.log(`   ✅ Payment completed: ${payment.transactionId}\n`);

    // Wait for data to be exported
    console.log('⏳ Waiting 3 seconds for data to be exported...');
    await delay(3000);

    console.log('\n✅ Test completed!\n');
    console.log('📊 Check the debug proxy terminal to see:');
    console.log('   - What requests were sent');
    console.log('   - What Datadog responded with');
    console.log('   - Any error messages\n');

  } catch (error) {
    logger.error('Application error', error instanceof Error ? error : new Error(String(error)));
    console.error('❌ Error:', error);
  } finally {
    console.log('🔄 Shutting down and flushing data...');
    await shutdown();
    console.log('✅ Shutdown complete');
  }

  process.exit(0);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  shutdown().then(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('Unhandled rejection', error);
  shutdown().then(() => process.exit(1));
});

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
