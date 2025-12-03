/**
 * AWS configuration types and utilities
 */

import type { AWSServiceConfig } from './types';

/**
 * AWS resource detector configuration
 */
export interface AWSResourceDetectorConfig {
  /**
   * Auto-detect EC2 instance metadata
   * @default true
   */
  ec2?: boolean;

  /**
   * Auto-detect ECS task metadata
   * @default true
   */
  ecs?: boolean;

  /**
   * Auto-detect EKS cluster metadata
   * @default true
   */
  eks?: boolean;

  /**
   * Auto-detect Lambda function metadata
   * @default true
   */
  lambda?: boolean;
}

/**
 * AWS initialization configuration
 */
export interface AWSInitConfig {
  /**
   * Service name
   */
  service: string;

  /**
   * OTLP endpoint
   */
  endpoint?: string;

  /**
   * OTLP headers (e.g., authentication tokens)
   */
  headers?: Record<string, string>;

  /**
   * Auto-detect AWS resources
   * @default false
   */
  autoDetectResources?: boolean | AWSResourceDetectorConfig;

  /**
   * AWS region
   */
  region?: string;

  /**
   * Additional resource attributes
   */
  resourceAttributes?: Record<string, string>;
}

/**
 * Lambda instrumentation configuration
 */
export interface LambdaInstrumentationConfig {
  /**
   * Capture response in span attributes
   * @default false
   */
  captureResponse?: boolean;

  /**
   * Extract trace context from event
   * @default true
   */
  extractTraceContext?: boolean;

  /**
   * Service name override
   */
  service?: string;
}

/**
 * SDK instrumentation configuration
 */
export interface SDKInstrumentationConfig {
  /**
   * Capture request payload
   * @default false
   */
  captureRequest?: boolean;

  /**
   * Capture response payload
   * @default false
   */
  captureResponse?: boolean;

  /**
   * Service name override
   */
  service?: string;
}

/**
 * X-Ray configuration
 */
export interface XRayConfig {
  /**
   * Enable X-Ray propagator
   * @default false
   */
  propagator?: boolean;

  /**
   * Enable X-Ray remote sampling
   * @default false
   */
  remoteSampling?: boolean;

  /**
   * Use X-Ray trace ID format
   * @default false
   */
  idGenerator?: boolean;
}

/**
 * Merge AWS service config with defaults
 */
export function mergeServiceConfig(
  config?: AWSServiceConfig,
  defaults?: AWSServiceConfig
): AWSServiceConfig {
  return {
    ...defaults,
    ...config,
  };
}
