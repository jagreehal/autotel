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
} from './context';

export { instrumentMcpServer } from './server';

export { instrumentMcpClient } from './client';

export type { McpInstrumentationConfig, McpTraceMeta } from './types';

export { DEFAULT_CONFIG } from './types';
