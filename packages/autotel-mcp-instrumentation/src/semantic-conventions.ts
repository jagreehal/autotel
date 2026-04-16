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
} as const;

/** Histogram bucket boundaries from spec (seconds) */
export const MCP_DURATION_BUCKETS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300,
];
