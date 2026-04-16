/**
 * autotel-mcp - OpenTelemetry instrumentation for Model Context Protocol
 *
 * Provides automatic distributed tracing for MCP servers and clients using
 * W3C Trace Context propagation via the `_meta` field.
 *
 * Follows the OTel MCP semantic conventions:
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
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

export {
  MCP_SEMCONV,
  MCP_METHODS,
  MCP_METRICS,
  MCP_DURATION_BUCKETS,
} from './semantic-conventions';

export {
  recordClientOperationDuration,
  recordServerOperationDuration,
} from './metrics';
