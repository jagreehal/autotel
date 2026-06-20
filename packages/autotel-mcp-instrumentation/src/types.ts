import type { Attributes } from '@opentelemetry/api';
import type { GuardLike, McpSecurityClassifier } from './security';

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

  // === Security observability ===

  /**
   * Capture tool annotation hints (`readOnlyHint`, `destructiveHint`,
   * `idempotentHint`, `openWorldHint`, `untrustedContentHint`) as
   * `mcp.tool.*` span attributes. Surfaces the "malicious manifest" vector and
   * lets agents reason about a tool's trust profile. Always-on, low cardinality.
   * @default true
   */
  captureToolAnnotations?: boolean;

  /**
   * Record serialized argument/result character sizes as
   * `mcp.tool.arguments.size` / `mcp.tool.result.size`. A cheap
   * token-exhaustion / contaminated-output signal (no payload content leaks).
   * @default true
   */
  recordPayloadSize?: boolean;

  /**
   * If set, tool outputs larger than this many characters record a
   * `mcp.security.budget.exceeded` signal and emit a `mcp.security.budget_exceeded`
   * event. Use {@link import('./semantic-conventions').MCP_CHAR_BUDGETS}.TOOL_OUTPUT
   * (1500) for the WebMCP-recommended limit. Off by default.
   */
  outputCharBudget?: number;

  /**
   * Pluggable prompt-injection / content classifier (Model Armor, Promptfoo, an
   * LLM critic, or `heuristicInjectionClassifier()`). When set, scans payloads
   * and records `mcp.security.injection.*` signals + a
   * `mcp.security.injection_suspected` event on non-clean verdicts. Classifier
   * failures never break the traced operation.
   */
  securityClassifier?: McpSecurityClassifier;

  /**
   * Scan tool arguments with the classifier (the inbound-request vector).
   * No-op without `securityClassifier`.
   * @default true
   */
  classifyArguments?: boolean;

  /**
   * Scan tool results with the classifier (the contaminated-output vector).
   * No-op without `securityClassifier`.
   * @default true
   */
  classifyResults?: boolean;

  /**
   * Scan manifest text surfaces (name, description, parameter descriptions)
   * with the classifier at registration time, then attach the assessment to
   * execution spans.
   * @default true
   */
  classifyDescriptions?: boolean;

  /**
   * Validate tool manifest text against the WebMCP character budgets and attach
   * the violations to execution spans.
   * @default true
   */
  validateToolBudgets?: boolean;

  /**
   * An `autotel-genai` guard / budget (or any `{ record(step) }`). Every tool
   * call is recorded as a step, so the genai kill-switch (cost/token/tool-call
   * ceilings, loop detection) enforces against MCP traffic. A `stop` rule throws,
   * halting the run. Duck-typed — no genai dependency is added.
   *
   * @example
   * ```typescript
   * import { createGenAiBudget } from 'autotel-genai/guard';
   * const guard = createGenAiBudget({ maxToolCalls: 50 });
   * instrumentMcpClient(client, { guard });
   * ```
   */
  guard?: GuardLike;

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
    | 'outputCharBudget'
    | 'securityClassifier'
    | 'guard'
  >
> & {
  customAttributes?: McpInstrumentationConfig['customAttributes'];
  networkTransport?: string;
  sessionId?: string;
  outputCharBudget?: number;
  securityClassifier?: McpSecurityClassifier;
  guard?: GuardLike;
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
    captureToolAnnotations:
      config?.captureToolAnnotations ?? DEFAULT_CONFIG.captureToolAnnotations,
    recordPayloadSize:
      config?.recordPayloadSize ?? DEFAULT_CONFIG.recordPayloadSize,
    classifyDescriptions:
      config?.classifyDescriptions ?? DEFAULT_CONFIG.classifyDescriptions,
    classifyArguments:
      config?.classifyArguments ?? DEFAULT_CONFIG.classifyArguments,
    classifyResults: config?.classifyResults ?? DEFAULT_CONFIG.classifyResults,
    validateToolBudgets:
      config?.validateToolBudgets ?? DEFAULT_CONFIG.validateToolBudgets,
    customAttributes: config?.customAttributes,
    networkTransport: config?.networkTransport,
    sessionId: config?.sessionId,
    outputCharBudget: config?.outputCharBudget,
    securityClassifier: config?.securityClassifier,
    guard: config?.guard,
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
  captureToolAnnotations: true,
  recordPayloadSize: true,
  classifyDescriptions: true,
  classifyArguments: true,
  classifyResults: true,
  validateToolBudgets: true,
} as const;
