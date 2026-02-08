import type { Attributes } from '@opentelemetry/api';

/**
 * Configuration options for MCP instrumentation
 */
export interface McpInstrumentationConfig {
  /**
   * Capture tool arguments as gen_ai.tool.call.arguments (opt-in per spec).
   * @default false
   */
  captureToolArgs?: boolean;

  /**
   * Capture tool results as gen_ai.tool.call.result (opt-in per spec).
   * Warning: May contain PII, disable in production.
   * @default false
   */
  captureToolResults?: boolean;

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

  /**
   * Network transport: 'pipe' (stdio), 'tcp' (HTTP/SSE).
   * Maps to network.transport attribute.
   */
  networkTransport?: 'pipe' | 'tcp' | string;

  /**
   * MCP session ID. Maps to mcp.session.id attribute.
   */
  sessionId?: string;

  /**
   * Enable metrics (operation duration histograms).
   * @default true
   */
  enableMetrics?: boolean;

  /**
   * Instrument discovery operations (tools/list, resources/list, etc.).
   * @default true
   */
  captureDiscoveryOperations?: boolean;

  // === Deprecated aliases (backward compatibility) ===

  /**
   * @deprecated Use `captureToolArgs` instead. Will be removed in next major version.
   */
  captureArgs?: boolean;

  /**
   * @deprecated Use `captureToolResults` instead. Will be removed in next major version.
   */
  captureResults?: boolean;
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
 * Resolve deprecated config aliases into canonical form.
 * New names take precedence over deprecated names.
 */
export function resolveConfig(config?: McpInstrumentationConfig): Required<
  Omit<
    McpInstrumentationConfig,
    | 'customAttributes'
    | 'networkTransport'
    | 'sessionId'
    | 'captureArgs'
    | 'captureResults'
  >
> & {
  customAttributes?: McpInstrumentationConfig['customAttributes'];
  networkTransport?: string;
  sessionId?: string;
} {
  return {
    captureToolArgs:
      config?.captureToolArgs ??
      config?.captureArgs ??
      DEFAULT_CONFIG.captureToolArgs,
    captureToolResults:
      config?.captureToolResults ??
      config?.captureResults ??
      DEFAULT_CONFIG.captureToolResults,
    captureErrors: config?.captureErrors ?? DEFAULT_CONFIG.captureErrors,
    enableMetrics: config?.enableMetrics ?? DEFAULT_CONFIG.enableMetrics,
    captureDiscoveryOperations:
      config?.captureDiscoveryOperations ??
      DEFAULT_CONFIG.captureDiscoveryOperations,
    customAttributes: config?.customAttributes,
    networkTransport: config?.networkTransport,
    sessionId: config?.sessionId,
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  captureToolArgs: false,
  captureToolResults: false,
  captureErrors: true,
  enableMetrics: true,
  captureDiscoveryOperations: true,
} as const;
