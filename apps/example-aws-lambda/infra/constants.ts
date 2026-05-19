import { StackProps } from 'aws-cdk-lib/core';

/**
 * How to ship OpenTelemetry data out of the function.
 *
 * - `custom-endpoint` — point `OTEL_EXPORTER_OTLP_ENDPOINT` at any OTLP
 *   collector (LocalStack, an OSS collector, Honeycomb, etc.). Default.
 * - `cloudwatch-direct` — use `autotel-aws/cloudwatch` to sign OTLP/JSON
 *   with SigV4 and POST straight to CloudWatch's native OTLP endpoints.
 *   No collector required, but cold-start cost lives in the handler.
 * - `cloudwatch-adot` — attach the AWS Distro for OpenTelemetry (ADOT)
 *   Lambda extension layer, configured to forward OTLP to CloudWatch's
 *   endpoints. Collector runs in a sidecar process, export latency lives
 *   outside the billed handler time.
 */
export type OtelMode = 'custom-endpoint' | 'cloudwatch-direct' | 'cloudwatch-adot';

export interface StackConfig extends StackProps {
  ENV: string;
  STACK_NAME: string;
  AWS_REGION?: string;
  OTEL_ENDPOINT: string;
  /** Telemetry shipping mode (see {@link OtelMode}). Defaults to `custom-endpoint`. */
  OTEL_MODE?: OtelMode;
  /**
   * ARN of the ADOT Lambda layer to attach when `OTEL_MODE='cloudwatch-adot'`.
   * Per-region. Lookup table:
   *   https://aws-otel.github.io/docs/getting-started/lambda
   */
  ADOT_LAYER_ARN?: string;
}

export const ENV = process.env.ENV || 'local';
export const STACK_NAME = `${ENV}-autotel-lambda`;

// Resource naming - prefixed with stack name for uniqueness
export const bucketName = (stackName: string) => `${stackName}-uploads`;
export const tableName = (stackName: string) => `${stackName}-users`;
export const queueName = (stackName: string) => `${stackName}-notifications`;
