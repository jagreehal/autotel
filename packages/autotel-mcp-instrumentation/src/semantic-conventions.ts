/**
 * OpenTelemetry MCP Semantic Conventions
 *
 * Attribute names, method names, and metric names from the
 * OpenTelemetry MCP semantic conventions specification.
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
  PROTOCOL_VERSION: 'mcp.protocol.version',
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
} as const;

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
  INITIALIZE: 'initialize',
} as const;

/** Metric names from OTel MCP semantic conventions */
export const MCP_METRICS = {
  CLIENT_OPERATION_DURATION: 'mcp.client.operation.duration',
  SERVER_OPERATION_DURATION: 'mcp.server.operation.duration',
  CLIENT_SESSION_DURATION: 'mcp.client.session.duration',
  SERVER_SESSION_DURATION: 'mcp.server.session.duration',
  /** Security signals counter (autotel extension). */
  SECURITY_EVENTS: 'mcp.security.events',
} as const;

/** Histogram bucket boundaries from spec (seconds) */
export const MCP_DURATION_BUCKETS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300,
];
