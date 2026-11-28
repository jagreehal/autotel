import type { Attributes } from '@opentelemetry/api';
import type {
  AgentFieldOption,
  IdentifyFn,
  ResolveOriginalTool,
  TaskHandleOptions,
} from './task-handles';

/** What a captured payload is, for `redactPayload`. */
export interface PayloadInfo {
  kind: 'input' | 'output';
  type: 'tool' | 'resource' | 'prompt';
  name: string;
}

/** What a piece of text is, for `redact`. */
export interface TextInfo {
  kind: 'intent' | 'error';
  name: string;
}
import type {
  GuardLike,
  McpSecurityClassifier,
  SecurityEventBridgeLike,
} from './security';

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
   * Whether to record failures: error status, `error.type` and the exception
   * event. The failure's text is kept only with `captureErrorMessages`.
   * @default true
   */
  captureErrors?: boolean;

  /**
   * Keep the failure's text (the thrown message, or an `isError` result's
   * text) on the span status and exception event. Tool errors often quote
   * the input that caused them, so it is off by default; `error.type` and
   * the failure category are always recorded.
   * @default false
   */
  captureErrorMessages?: boolean;

  /**
   * Transform captured arguments and results before they are recorded
   * (`captureToolArgs`, `captureToolResults`). Return what to record; throwing
   * records nothing. Nothing is scrubbed for you.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Public redactor hook: receives a captured client payload of whatever shape the caller sent and returns whatever the application chooses to record.
  redactPayload?: (value: unknown, info: PayloadInfo) => unknown;

  /**
   * Transform the agent-reported intent and captured failure text before they
   * are recorded. Return `undefined` to drop it.
   */
  redact?: (text: string, info: TextInfo) => string | undefined;

  /**
   * For low-level servers whose tool schemas depend on the caller: the tool as
   * the server defines it for this request, before any injection. Without it,
   * which arguments were injected is read from the last listing.
   */
  resolveOriginalTool?: ResolveOriginalTool;

  /**
   * On a stateless 2025-era Streamable HTTP server, return an opaque
   * `Mcp-Session-Id` on `initialize` that carries the client's reported name
   * and version, so later requests (each on a fresh server) still name their
   * client. A native session id is never replaced. Client-reported, not a
   * credential.
   * @default true
   */
  statelessClientIdentity?: boolean;

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
   * Fallback for `mcp.session.id`, used only when the request itself carries
   * no session.
   *
   * Prefer leaving this unset: a 2025-era request supplies its own session and
   * that is always used in preference, so one instrumented server stays
   * correct across many callers. This exists for legacy stdio, whose transport
   * has no session at all and whose only meaningful identifier is one the
   * process picks for itself. It is ignored on 2026-07-28, which has no
   * sessions.
   */
  sessionId?: string;

  /**
   * Correlate one agent's calls on a stateless (2026-07-28) server: adds a
   * `session_id` parameter to every tool, issued on the first call and echoed
   * back on later ones (SEP-2567 explicit handles), recorded as
   * `gen_ai.conversation.id`. `{ agentId: true }` also asks for a self-chosen
   * `agent_id` (`gen_ai.agent.id`); `{ resolveSessionId }` derives the session
   * from your own identifier instead and changes no schema; `{ argument }`
   * reads a conversation id your tools already take. Off by default:
   * agents see the extra parameters.
   */
  sessionHandles?: boolean | TaskHandleOptions;

  /**
   * Add a `context` parameter asking the agent, in one sentence, why it is
   * calling the tool; recorded as `mcp.tool.call.intent`. Model-written free
   * text: route it through your attribute redactor. Off by default.
   * `{ argument: 'intent' }` reads a parameter your tools already declare
   * (left in place for the handler) and adds it to tools that lack it.
   */
  captureIntent?: AgentFieldOption;

  /**
   * Add an `agent_model` parameter asking the agent which model it runs as;
   * recorded as `mcp.agent.model`. Unverified: the agent's own report.
   * `{ argument: 'model' }` reads a parameter your tools already declare.
   * Off by default.
   */
  captureModel?: AgentFieldOption;

  /**
   * List a `get_more_tools` tool agents call to report a capability they
   * looked for and could not find; each report is a tool span carrying
   * `mcp.missing_tool.description`. Off by default.
   */
  reportMissingTools?: boolean;

  /**
   * Resolve the caller to a stable user id (`user.id`) from the request and
   * the SDK context (`ctx.http.authInfo` on v2). Runs alongside the tool and
   * is never awaited: a slow or failing lookup loses the attribute, not time.
   */
  identify?: IdentifyFn;

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

  /**
   * Bridge MCP boundary signals to the unified `security.*` schema via
   * {@link securityEventBridge}. Off by default. Pair with
   * `createMcpSecurityEventBridge()` from `autotel-audit`.
   * @default false
   */
  bridgeSecurityEvents?: boolean;

  /**
   * Callback invoked when `bridgeSecurityEvents` is true. Maps injection
   * verdicts and output-budget breaches to `securityEvent()`-compatible metadata.
   */
  securityEventBridge?: SecurityEventBridgeLike;

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
    | 'bridgeSecurityEvents'
    | 'securityEventBridge'
    | 'sessionHandles'
    | 'captureIntent'
    | 'captureModel'
    | 'reportMissingTools'
    | 'identify'
    | 'redactPayload'
    | 'redact'
    | 'resolveOriginalTool'
  >
> & {
  redactPayload?: McpInstrumentationConfig['redactPayload'];
  redact?: McpInstrumentationConfig['redact'];
  customAttributes?: McpInstrumentationConfig['customAttributes'];
  networkTransport?: string;
  sessionId?: string;
  outputCharBudget?: number;
  securityClassifier?: McpSecurityClassifier;
  guard?: GuardLike;
  bridgeSecurityEvents?: boolean;
  securityEventBridge?: SecurityEventBridgeLike;
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
    captureErrorMessages:
      config?.captureErrorMessages ?? DEFAULT_CONFIG.captureErrorMessages,
    statelessClientIdentity:
      config?.statelessClientIdentity ?? DEFAULT_CONFIG.statelessClientIdentity,
    redactPayload: config?.redactPayload,
    redact: config?.redact,
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
    bridgeSecurityEvents: config?.bridgeSecurityEvents ?? false,
    securityEventBridge: config?.securityEventBridge,
  };
}

/** Resolve an active security-event bridge from resolved MCP config. */
export function resolveSecurityEventBridge(
  config: Pick<
    ReturnType<typeof resolveConfig>,
    'bridgeSecurityEvents' | 'securityEventBridge'
  >,
): SecurityEventBridgeLike | undefined {
  if (!config.bridgeSecurityEvents || !config.securityEventBridge) {
    return undefined;
  }
  return config.securityEventBridge;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  captureToolArgs: false,
  captureToolResults: false,
  captureErrors: true,
  captureErrorMessages: false,
  statelessClientIdentity: true,
  enableMetrics: true,
  captureDiscoveryOperations: true,
  captureToolAnnotations: true,
  recordPayloadSize: true,
  classifyDescriptions: true,
  classifyArguments: true,
  classifyResults: true,
  validateToolBudgets: true,
} as const;

/** The arguments an MCP tool call carries: the JSON its schema declared. */
export type McpArguments = {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | McpArguments
    | Array<McpArguments | string | number | boolean | null>;
};

/** What an MCP tool, prompt or resource handler resolves with. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The SDK owns the result shape and adds fields by era (structuredContent, resultType, _meta); the wrapper forwards them unread.
export type McpHandlerResult = {
  content?: Array<{ type: string; text?: string }>;
  contents?: Array<{ uri: string; text?: string }>;
  isError?: boolean;
  [key: string]: unknown;
};

/**
 * A wrapped MCP handler. The SDK calls it with whatever the client sent, which
 * each handler's own schema describes - the wrapper only forwards it.
 */
export type McpHandler = (
  ...args: McpHandlerArgument[]
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- McpHandlerResult's open index carries the SDK-owned result fields above.
) => Promise<McpHandlerResult>;

/** One argument the SDK passes a handler: a payload, a URL, or an extra. */
export type McpHandlerArgument = McpArguments | URL | string | undefined;

/** The attributes recorded on an MCP metric; keys are added as they are known. */
export type McpMetricAttributes = Record<string, string | boolean>;
