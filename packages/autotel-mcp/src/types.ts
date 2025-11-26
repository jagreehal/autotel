import type { Attributes } from '@opentelemetry/api';

/**
 * Configuration options for MCP instrumentation
 */
export interface McpInstrumentationConfig {
  /**
   * Whether to capture tool/resource arguments as span attributes
   * @default true
   */
  captureArgs?: boolean;

  /**
   * Whether to capture tool/resource results as span attributes
   * Warning: May contain PII, disable in production
   * @default false
   */
  captureResults?: boolean;

  /**
   * Whether to capture errors and exceptions
   * @default true
   */
  captureErrors?: boolean;

  /**
   * Custom function to extract additional span attributes
   */
  customAttributes?: (context: {
    type: 'tool' | 'resource' | 'prompt';
    name: string;
    args?: unknown;
    result?: unknown;
  }) => Attributes;
}

/**
 * Metadata field for W3C Trace Context propagation
 */
export interface McpTraceMeta {
  /**
   * W3C Trace Context traceparent header
   * Format: version-trace-id-parent-id-trace-flags
   */
  traceparent?: string;

  /**
   * W3C Trace Context tracestate header
   * Vendor-specific trace data
   */
  tracestate?: string;

  /**
   * W3C Baggage header
   * Cross-cutting concerns (user ID, request ID, etc.)
   */
  baggage?: string;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<
  Omit<McpInstrumentationConfig, 'customAttributes'>
> = {
  captureArgs: true,
  captureResults: false,
  captureErrors: true,
};
