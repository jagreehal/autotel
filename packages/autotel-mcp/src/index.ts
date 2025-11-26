/**
 * autotel-mcp - OpenTelemetry instrumentation for Model Context Protocol
 *
 * Provides automatic distributed tracing for MCP servers and clients using
 * W3C Trace Context propagation via the `_meta` field.
 *
 * @packageDocumentation
 */

// Re-export everything from submodules
export {
  extractOtelContextFromMeta,
  injectOtelContextToMeta,
  activateTraceContext,
} from './context.js';

export { instrumentMcpServer } from './server.js';

export { instrumentMcpClient } from './client.js';

export type { McpInstrumentationConfig, McpTraceMeta } from './types.js';

export { DEFAULT_CONFIG } from './types.js';
