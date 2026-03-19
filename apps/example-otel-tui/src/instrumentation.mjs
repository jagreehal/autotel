/**
 * ESM Instrumentation - loaded BEFORE the main app
 *
 * Sets up:
 * 1. Pino instrumentation (injects trace_id/span_id into log records)
 * 2. OTLP log exporter (sends logs to otel-tui on port 4318)
 * 3. OTLP trace exporter (sends traces/spans to otel-tui on port 4318)
 *
 * Run with: tsx --import ./src/instrumentation.mjs src/index.ts
 */

import 'autotel/register';

import { init } from 'autotel';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

const endpoint = process.env.OTLP_ENDPOINT || 'http://localhost:4318';

init({
  service: 'example-otel-tui',
  endpoint,
  // Send logs via OTLP so otel-tui can correlate them with traces
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${endpoint}/v1/logs`,
      })
    ),
  ],
  // Enable pino instrumentation to inject trace_id/span_id into logs
  instrumentations: getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-pino': { enabled: true },
  }),
  // Disable autoInstrumentations since we're providing our own
  autoInstrumentations: false,
});

console.log(`✅ Instrumentation ready — sending traces + logs to ${endpoint}`);
