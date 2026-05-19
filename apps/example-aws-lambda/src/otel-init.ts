/**
 * Telemetry init shared by all handlers.
 *
 * Reads the `OTEL_MODE` env var (set by the CDK stack) to pick between
 * three exporter strategies:
 *
 *   - `custom-endpoint` (default) — `init({ endpoint })`. Whatever URL is
 *     in OTEL_EXPORTER_OTLP_ENDPOINT receives OTLP. Used for LocalStack,
 *     standalone collectors, and vendor backends.
 *
 *   - `cloudwatch-direct` — bypass autotel's default exporters and wire
 *     CloudWatch trace/log/metric exporters (SigV4-signed OTLP/JSON straight
 *     to CloudWatch native endpoints) through custom processors/readers.
 *
 *   - `cloudwatch-adot` — `init({ endpoint })` again, but the endpoint is
 *     the localhost OTLP receiver exposed by the ADOT Lambda layer. The
 *     layer's collector handles SigV4 signing on the way out.
 */

import { init } from 'autotel';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  CloudWatchLogExporter,
  CloudWatchMetricExporter,
  CloudWatchTraceExporter,
} from 'autotel-aws/cloudwatch';

export function initTelemetry(service: string): void {
  const mode = process.env.OTEL_MODE ?? 'custom-endpoint';

  if (mode === 'cloudwatch-direct') {
    const region = process.env.AWS_REGION;
    init({
      service,
      spanProcessors: [
        new BatchSpanProcessor(
          new CloudWatchTraceExporter({
            region,
          }),
        ),
      ],
      logRecordProcessors: [
        new BatchLogRecordProcessor(
          new CloudWatchLogExporter({
            region,
          }),
        ),
      ],
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new CloudWatchMetricExporter({
            region,
            // Delta is preferred for CloudWatch OTLP counters.
            temporalitySelector: () => AggregationTemporality.DELTA,
          }),
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    return;
  }

  // `custom-endpoint` and `cloudwatch-adot` both use the default endpoint
  // path — the ADOT collector is reachable on localhost when its layer is
  // attached, and the env var is set accordingly by the CDK.
  init({
    service,
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      'http://localhost:4318',
  });
}
