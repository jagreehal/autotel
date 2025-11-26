/**
 * Datadog + Autotel Integration Example
 *
 * This example demonstrates how to use autotel with Datadog using OTLP.
 * All observability signals (traces, logs, metrics) are sent to Datadog.
 *
 * Prerequisites:
 * 1. Datadog account with API key
 * 2. Copy .env.example to .env and add your DATADOG_API_KEY
 *
 * Run:
 * pnpm install
 * cp .env.example .env  # Add your DATADOG_API_KEY
 * pnpm start
 *
 * View results in Datadog:
 * - Traces: APM → Traces
 * - Logs: Logs → Search (filter by service:example-datadog)
 * - Metrics: Metrics → Explorer
 */

import 'dotenv/config';
import { init, trace, shutdown, Metric, type TraceContext } from 'autotel';
import { createLogger, LOG_LEVEL, type LogLevel } from 'autotel/logger';
import { createDatadogConfig, type DatadogSite } from 'autotel/presets/datadog';

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

function displayConfig(cfg: AppConfig): void {
  console.log('🔧 Configuration:');
  console.log(`   Service: ${cfg.service}`);
  console.log(`   Environment: ${cfg.environment}`);
  if (cfg.version) {
    console.log(`   Version: ${cfg.version}`);
  }
  console.log(`   Datadog Site: ${cfg.site}`);
  console.log(`   OTLP Endpoint: https://otlp.${cfg.site}`);
  console.log(`                  ↳ Traces: /v1/traces`);
  console.log(`                  ↳ Metrics: /v1/metrics`);
  if (cfg.enableLogExport) {
    console.log(`                  ↳ Logs: /v1/logs`);
  }
  console.log(`   Log Export: ${cfg.enableLogExport ? 'Enabled' : 'Disabled'}`);
  console.log('');
}

displayConfig(config);

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
// Initialize Autotel with Datadog OTLP
// ============================================================================

// Create logger first (used by init for internal logging)
const logger = createLogger('datadog-example', {
  level: config.logLevel,
  pretty: config.environment !== 'production',
});

// Initialize autotel with Datadog OTLP cloud ingestion
// Sends data directly to Datadog via OTLP endpoints:
// - Traces:  https://otlp.{site}/v1/traces
// - Metrics: https://otlp.{site}/v1/metrics
// - Logs:    https://otlp.{site}/v1/logs
// - Header:  dd-api-key
init(
  createDatadogConfig({
    apiKey: config.apiKey,
    site: config.site,
    service: config.service,
    environment: config.environment,
    version: config.version,
    enableLogs: config.enableLogExport,
  })
);

logger.info('✅ Autotel initialized with Datadog OTLP');
logger.info(
  `   Sending telemetry to https://otlp.${config.site}`,
);

// Note: Adaptive sampling is enabled by default (10% baseline, 100% errors/slow)
// This reduces costs while ensuring you capture all important traces

// Create metrics instance for tracking business metrics
const metrics = new Metric('datadog-example', { logger });

// ============================================================================
// Example Functions with Tracing
// ============================================================================

/**
 * Example 1: Simple traced function
 * Demonstrates basic trace() usage with custom attributes
 */
const processOrder = trace((ctx: TraceContext) => async (orderId: string, amount: number) => {
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

/**
 * Example 2: Nested traced functions
 * Demonstrates parent-child span relationships
 */
const validatePayment = trace((ctx: TraceContext) => async (orderId: string, amount: number) => {
  logger.info('Validating payment', { orderId });

  ctx.setAttribute('payment.amount', amount);

  // Simulate validation
  await delay(SIMULATION_DELAYS.PAYMENT_VALIDATION);

  if (amount < 0) {
    throw new Error('Invalid payment amount');
  }

  return { valid: true };
});

const chargeCard = trace((ctx: TraceContext) => async (orderId: string) => {
  logger.info('Charging card', { orderId });

  ctx.setAttribute('payment.method', 'credit_card');

  // Simulate charging
  await delay(SIMULATION_DELAYS.CARD_CHARGING);

  return { transactionId: `txn_${Date.now()}` };
});

const processPayment = trace((ctx: TraceContext) => async (orderId: string, amount: number) => {
  logger.info('Processing payment', { orderId, amount });

  ctx.setAttribute('order.id', orderId);
  ctx.setAttribute('payment.amount', amount);

  // These create child spans automatically
  await validatePayment(orderId, amount);
  const charge = await chargeCard(orderId);

  logger.info('Payment completed', { orderId, transactionId: charge.transactionId });

  return charge;
});

/**
 * Example 3: Error handling and capture
 * Demonstrates how errors are automatically captured in traces
 */
const processRefund = trace((ctx: TraceContext) => async (orderId: string) => {
  logger.info('Processing refund', { orderId });

  ctx.setAttribute('refund.order_id', orderId);

  // Simulate error scenario
  if (shouldSimulateFailure(REFUND_FAILURE_PROBABILITY)) {
    // Error is automatically captured in the trace with full stack trace
    const error = new Error('Refund failed: insufficient funds');
    logger.error('Refund failed: insufficient funds', error, { orderId });
    throw error;
  }

  await delay(SIMULATION_DELAYS.REFUND_PROCESSING);

  logger.info('Refund processed successfully', { orderId });

  return { orderId, status: 'refunded' as const };
});

/**
 * Example 4: Complex operation with multiple metrics
 * Demonstrates metrics recording alongside traces
 */
const generateReport = trace((ctx: TraceContext) => async (reportType: string) => {
  logger.info('Generating report', { reportType });

  ctx.setAttribute('report.type', reportType);

  const startTime = Date.now();

  // Simulate report generation
  await delay(SIMULATION_DELAYS.REPORT_GENERATION);

  const duration = Date.now() - startTime;
  const recordCount = Math.floor(Math.random() * 1000) + 100;

  // Track multiple metrics
  metrics.trackEvent('report.generated', {
    report_type: reportType,
  });

  metrics.trackValue('report.duration_ms', duration, {
    report_type: reportType,
  });

  metrics.trackValue('report.records', recordCount, {
    report_type: reportType,
  });

  ctx.setAttribute('report.records', recordCount);
  ctx.setAttribute('report.duration_ms', duration);

  logger.info('Report generated successfully', { reportType, recordCount, duration });

  return { reportType, recordCount, duration };
});

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log('🚀 Starting Datadog integration examples...\n');

  try {
    // Example 1: Process multiple orders
    console.log('📦 Example 1: Processing orders');
    const order1 = await processOrder('ORD-001', 99.99);
    const order2 = await processOrder('ORD-002', 149.50);
    console.log(`   ✅ Processed ${order1.orderId} and ${order2.orderId}\n`);

    // Example 2: Process payment with nested spans
    console.log('💳 Example 2: Processing payment (nested spans)');
    const payment = await processPayment('ORD-001', 99.99);
    console.log(`   ✅ Payment completed: ${payment.transactionId}\n`);

    // Example 3: Process multiple refunds (some may fail)
    console.log('🔄 Example 3: Processing refunds (error handling)');
    for (let i = 1; i <= 5; i++) {
      try {
        await processRefund(`ORD-${String(i).padStart(3, '0')}`);
        console.log(`   ✅ Refund ${i} processed`);
      } catch (error) {
        console.log(`   ⚠️  Refund ${i} failed (error captured in trace)`);
      }
    }
    console.log('');

    // Example 4: Generate reports with metrics
    console.log('📊 Example 4: Generating reports (with metrics)');
    const report1 = await generateReport('daily_sales');
    const report2 = await generateReport('monthly_summary');
    console.log(`   ✅ Generated ${report1.reportType}: ${report1.recordCount} records`);
    console.log(`   ✅ Generated ${report2.reportType}: ${report2.recordCount} records\n`);

    // Wait for data to be exported
    console.log('⏳ Waiting 3 seconds for data to be exported to Datadog...');
    await delay(3000);

    console.log('\n✅ Examples completed successfully!\n');
    console.log('📊 View your data in Datadog:');
    console.log(`   Traces: https://app.${config.site}/apm/traces?query=service%3A${config.service}`);
    console.log(`   Logs:   https://app.${config.site}/logs?query=service%3A${config.service}`);
    console.log(`   Metrics: https://app.${config.site}/metric/explorer?query=${config.service}`);
    console.log('\n💡 Tips:');
    console.log('   - Logs include trace_id and span_id for correlation');
    console.log('   - Failed refunds have error traces with full stack traces');
    console.log('   - Custom metrics are prefixed with your service name');
    console.log('   - Adaptive sampling captures all errors automatically');

  } catch (error) {
    logger.error('Application error', error instanceof Error ? error : new Error(String(error)));
    console.error('❌ Error:', error);
  } finally {
    // Graceful shutdown: flush all pending traces, logs, and metrics
    console.log('\n🔄 Shutting down and flushing data...');
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
