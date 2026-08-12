/**
 * OpenTelemetry MCP Semantic Conventions
 *
 * Attribute names, method names, and metric names from the
 * OpenTelemetry MCP semantic conventions specification.
 *
 * Covers both MCP eras. 2026-07-28 is stateless — no `initialize` handshake
 * and no session — so the session-scoped keys are era-dependent: they are set
 * when a 2025-era request carries them and simply absent otherwise. The
 * `mcp.*.session.duration` metrics are gone, having nothing left to measure
 * on the current revision.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
 */

/** Attribute names from OTel MCP semantic conventions */
export const MCP_SEMCONV = {
  // Required
  METHOD_NAME: 'mcp.method.name',

  // Conditionally required
  ERROR_TYPE: 'error.type',
  TOOL_NAME: 'gen_ai.tool.name',
  PROMPT_NAME: 'gen_ai.prompt.name',
  RESOURCE_URI: 'mcp.resource.uri',
  REQUEST_ID: 'jsonrpc.request.id',
  RESPONSE_STATUS_CODE: 'rpc.response.status_code',

  // Recommended
  OPERATION_NAME: 'gen_ai.operation.name',
  // Per-request as of MCP 2026-07-28: the client stamps its protocol revision
  // into every request's `_meta` envelope, so this is read off the request
  // rather than off a handshake that no longer happens.
  PROTOCOL_VERSION: 'mcp.protocol.version',
  // 2025-era only — 2026-07-28 removed the session (SEP-2567). Read off the
  // request, so it is simply absent on a stateless connection.
  SESSION_ID: 'mcp.session.id',
  NETWORK_TRANSPORT: 'network.transport',
  SERVER_ADDRESS: 'server.address',
  SERVER_PORT: 'server.port',
  CLIENT_ADDRESS: 'client.address',
  CLIENT_PORT: 'client.port',

  // Opt-in
  TOOL_CALL_ARGUMENTS: 'gen_ai.tool.call.arguments',
  TOOL_CALL_RESULT: 'gen_ai.tool.call.result',

  // === Security & safety (autotel extensions) ===
  // These keys are not (yet) in the upstream OTel MCP semconv. They make the
  // agentic-web threat model observable at the MCP protocol boundary, aligned
  // with Chrome/Google's WebMCP security guidance (June 2026).

  // Tool annotation hints — surface the "malicious manifest" vector and let an
  // agent reason about trust. Mirror the MCP `annotations` block + WebMCP hints.
  TOOL_READ_ONLY: 'mcp.tool.read_only', // readOnlyHint
  TOOL_DESTRUCTIVE: 'mcp.tool.destructive', // destructiveHint
  TOOL_IDEMPOTENT: 'mcp.tool.idempotent', // idempotentHint
  TOOL_OPEN_WORLD: 'mcp.tool.open_world', // openWorldHint
  TOOL_UNTRUSTED_CONTENT: 'mcp.tool.untrusted_content', // untrustedContentHint

  // Multi-round-trip (MCP 2026-07-28): the call returned `input_required`
  // instead of a result — it paused for elicitation/sampling and will be
  // retried. Without this, a latency histogram mixes "did the work" with
  // "asked a question", and the retry looks like a duplicate call.
  // Deliberately NOT under `mcp.tool.*`: `prompts/get` and `resources/read`
  // can pause too, and a tool-namespaced key on those spans splits their
  // duration series under a label nothing else there uses.
  INPUT_REQUIRED: 'mcp.input_required',

  // Payload sizes (chars) — the "contaminated output" / token-exhaustion signal.
  PAYLOAD_ARGUMENTS_SIZE: 'mcp.arguments.size',
  PAYLOAD_RESULT_SIZE: 'mcp.result.size',
  TOOL_ARGUMENTS_SIZE: 'mcp.tool.arguments.size',
  TOOL_RESULT_SIZE: 'mcp.tool.result.size',

  // Character-budget enforcement (WebMCP recommended limits).
  SECURITY_BUDGET_EXCEEDED: 'mcp.security.budget.exceeded',
  SECURITY_BUDGET_LIMIT: 'mcp.security.budget.limit',
  SECURITY_BUDGET_OBSERVED: 'mcp.security.budget.observed',

  // Prompt-injection classification signal (pluggable classifier / critic).
  SECURITY_INJECTION_SUSPECTED: 'mcp.security.injection.suspected',
  SECURITY_INJECTION_VERDICT: 'mcp.security.injection.verdict', // clean|suspicious|malicious
  SECURITY_INJECTION_SCORE: 'mcp.security.injection.score', // 0..1
  SECURITY_INJECTION_CATEGORIES: 'mcp.security.injection.categories', // csv
  SECURITY_INJECTION_SOURCE: 'mcp.security.injection.source', // arguments|result|description

  // Manifest-time classifier / budget signals (tool/prompt/resource metadata).
  SECURITY_MANIFEST_SUSPECTED: 'mcp.security.manifest.suspected',
  SECURITY_MANIFEST_VERDICT: 'mcp.security.manifest.verdict',
  SECURITY_MANIFEST_SCORE: 'mcp.security.manifest.score',
  SECURITY_MANIFEST_CATEGORIES: 'mcp.security.manifest.categories',
  SECURITY_MANIFEST_BUDGET_VIOLATION_COUNT:
    'mcp.security.manifest.budget.violation_count',

  // Spotlighting (untrusted-content demarcation) applied to a payload.
  SECURITY_SPOTLIGHT_METHOD: 'mcp.security.spotlight.method', // delimit|base64

  // === Failure grouping (autotel extensions) ===
  // `error.type` says a call failed; these say whether it is the SAME failure
  // as the last one. The fingerprint is derived from the failure text with
  // run-specific values stripped, so two occurrences of one bug agree on it
  // even across processes — which is what makes it usable as a correlation key
  // on a stateless deployment, where there is no session to group by.
  FAILURE_CATEGORY: 'mcp.failure.category', // low cardinality, safe on metrics
  FAILURE_FINGERPRINT: 'mcp.failure.fingerprint', // span-only: one per cause
} as const;

/**
 * Failure channels, ordered most specific first — {@link classifyFailure}
 * returns the first that matches, so a "connection timed out" reads as a
 * timeout rather than a network fault.
 *
 * Deliberately coarse. The category answers "who should look at this?" and is
 * low-cardinality enough for a metric label; the fingerprint answers "is this
 * the same bug?" and stays on the span.
 */
export const MCP_FAILURE_CATEGORY = {
  /** Rejected credentials, scopes, or permissions. */
  AUTH: 'auth',
  /** Deadline elapsed before the work finished. */
  TIMEOUT: 'timeout',
  /** Could not reach the peer at all. */
  NETWORK: 'network',
  /** Arguments did not satisfy the tool's schema. */
  VALIDATION: 'validation',
  /** Payload could not be parsed or encoded. */
  SERIALIZATION: 'serialization',
  /** An upstream the tool depends on failed. */
  DEPENDENCY: 'dependency',
  /** Anything left: a bug in the tool itself, until proven otherwise. */
  INTERNAL: 'internal',
} as const;

export type McpFailureCategory =
  (typeof MCP_FAILURE_CATEGORY)[keyof typeof MCP_FAILURE_CATEGORY];

/**
 * `_meta` key carrying the protocol revision of a single request (MCP
 * 2026-07-28 per-request envelope). Mirrors the SDK's
 * `PROTOCOL_VERSION_META_KEY` — declared here so this package keeps its
 * duck-typed, zero-runtime-dependency relationship with the MCP SDK.
 */
export const MCP_PROTOCOL_VERSION_META_KEY =
  'io.modelcontextprotocol/protocolVersion';

/** Security event names (emitted via ctx.track). */
export const MCP_SECURITY_EVENT = {
  INJECTION_SUSPECTED: 'mcp.security.injection_suspected',
  BUDGET_EXCEEDED: 'mcp.security.budget_exceeded',
  MANIFEST_SUSPECTED: 'mcp.security.manifest_suspected',
  MANIFEST_BUDGET_EXCEEDED: 'mcp.security.manifest_budget_exceeded',
} as const;

/**
 * WebMCP recommended character budgets (chars). Exceeding these risks tripping
 * agent guardrails or wasting context window. Source: Chrome WebMCP "secure
 * tools" guidance, June 2026.
 */
export const MCP_CHAR_BUDGETS = {
  TOOL_NAME: 30,
  PARAM_NAME: 30,
  TOOL_DESCRIPTION: 500,
  PARAM_DESCRIPTION: 150,
  TOOL_OUTPUT: 1500,
} as const;

/** Well-known MCP method names */
export const MCP_METHODS = {
  TOOLS_CALL: 'tools/call',
  TOOLS_LIST: 'tools/list',
  RESOURCES_READ: 'resources/read',
  RESOURCES_LIST: 'resources/list',
  PROMPTS_GET: 'prompts/get',
  PROMPTS_LIST: 'prompts/list',
  PING: 'ping',
  /** Replaces the `initialize` handshake removed in 2026-07-28 (SEP-2575). */
  SERVER_DISCOVER: 'server/discover',
} as const;

/** Metric names from OTel MCP semantic conventions */
export const MCP_METRICS = {
  CLIENT_OPERATION_DURATION: 'mcp.client.operation.duration',
  SERVER_OPERATION_DURATION: 'mcp.server.operation.duration',
  /** Security signals counter (autotel extension). */
  SECURITY_EVENTS: 'mcp.security.events',
} as const;

/** Histogram bucket boundaries from spec (seconds) */
export const MCP_DURATION_BUCKETS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300,
];
