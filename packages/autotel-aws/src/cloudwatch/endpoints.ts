/**
 * CloudWatch native OTLP HTTP endpoints.
 *
 * Reference: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html
 *
 * All three endpoints accept OTLP/HTTP (JSON or protobuf, optional gzip)
 * and require AWS Signature V4 authentication. They land data in:
 *
 *   - traces  → X-Ray + Application Signals + Transaction Search
 *   - logs    → CloudWatch Logs (needs x-aws-log-group + x-aws-log-stream headers)
 *   - metrics → CloudWatch Metrics, queryable via PromQL
 */

export interface CloudWatchEndpointInput {
  readonly region: string;
}

/** Traces — signed against the `xray` service. */
export function cloudWatchTracesEndpoint({ region }: CloudWatchEndpointInput): string {
  return `https://xray.${region}.amazonaws.com/v1/traces`;
}

/** Logs — signed against the `logs` service. Requires log group/stream headers. */
export function cloudWatchLogsEndpoint({ region }: CloudWatchEndpointInput): string {
  return `https://logs.${region}.amazonaws.com/v1/logs`;
}

/** Metrics — signed against the `monitoring` service. */
export function cloudWatchMetricsEndpoint({ region }: CloudWatchEndpointInput): string {
  return `https://monitoring.${region}.amazonaws.com/v1/metrics`;
}

/**
 * The SigV4 service name used when signing requests for each endpoint.
 * These do NOT always match the host prefix — they're the canonical
 * AWS service identifiers used by the SigV4 signer.
 */
export const SIGV4_SERVICE = {
  traces: 'xray',
  logs: 'logs',
  metrics: 'monitoring',
} as const;

export type CloudWatchSignal = keyof typeof SIGV4_SERVICE;
