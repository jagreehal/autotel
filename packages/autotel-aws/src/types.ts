/**
 * AWS-specific types for autotel-aws
 */

import type { SpanContext } from '@opentelemetry/api';

/**
 * AWS Lambda event types
 */
export interface LambdaEvent {
  headers?: Record<string, string>;
  Records?: Array<{
    messageAttributes?: Record<string, { DataType: string; StringValue?: string }>;
    Sns?: {
      MessageAttributes?: Record<string, { Type: string; Value?: string }>;
    };
    kinesis?: {
      data?: string;
    };
  }>;
  _autotel_trace_context?: SpanContext;
  [key: string]: unknown;
}

/**
 * AWS Lambda context
 */
export interface LambdaContext {
  awsRequestId: string;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  getRemainingTimeInMillis: () => number;
  [key: string]: unknown;
}

/**
 * AWS SDK v3 command metadata
 */
export interface AWSCommandMetadata {
  clientName: string;
  commandName: string;
  requestId?: string;
  httpStatusCode?: number;
  extendedRequestId?: string;
  cfId?: string;
}

/**
 * AWS service configuration
 */
export interface AWSServiceConfig {
  region?: string;
  endpoint?: string;
  [key: string]: unknown;
}

/**
 * X-Ray annotation entry
 */
export interface XRayAnnotation {
  key: string;
  value: string | number | boolean;
}

/**
 * Trace context extraction result
 */
export interface ExtractedTraceContext {
  spanContext: SpanContext;
  traceState?: string;
}
