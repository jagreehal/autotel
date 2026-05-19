/**
 * autotel-aws/cloudwatch
 *
 * Ship OpenTelemetry data straight to CloudWatch's native OTLP endpoints
 * without running a collector:
 *
 *   - Traces  → X-Ray / Application Signals / Transaction Search
 *   - Logs    → CloudWatch Logs (Logs Insights, LiveTail)
 *   - Metrics → CloudWatch Metrics (queryable via PromQL)
 *
 * All three endpoints use SigV4 authentication. This module supplies
 * exporters that serialize OTLP/JSON, sign with SigV4, and POST via
 * `globalThis.fetch` (Node 18+).
 *
 * ## Required dependencies
 *
 * These are optional peer dependencies of `autotel-aws` — install only
 * if you use the CloudWatch exporters:
 *
 *   - `@smithy/signature-v4`
 *   - `@aws-crypto/sha256-js`
 *   - `@aws-sdk/credential-providers` (only needed if you don't pass
 *     `credentials` explicitly to the exporter)
 *
 * ## Example
 *
 * ```ts
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
 * import { CloudWatchTraceExporter } from 'autotel-aws/cloudwatch';
 *
 * const provider = new NodeTracerProvider({
 *   spanProcessors: [
 *     new BatchSpanProcessor(new CloudWatchTraceExporter({ region: 'eu-west-1' })),
 *   ],
 * });
 * provider.register();
 * ```
 *
 * In Lambda call `provider.forceFlush()` (or use a span processor configured
 * with `scheduledDelayMillis: 0`) before the handler returns so spans land
 * before the runtime is frozen.
 */

export * from './endpoints';
export * from './sigv4';
export * from './trace-exporter';
export * from './log-exporter';
export * from './metric-exporter';
