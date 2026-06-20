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
  MCP_SECURITY_EVENT,
  MCP_CHAR_BUDGETS,
} from './semantic-conventions';

export {
  recordClientOperationDuration,
  recordServerOperationDuration,
  recordSecurityEvent,
} from './metrics';

// Security observability — annotations, payload sizing, char budgets,
// pluggable injection classifier, and spotlighting helpers.
export {
  applyManifestAssessment,
  applyToolAnnotations,
  assessManifest,
  enforceOutputBudget,
  extractManifestTextSurface,
  heuristicInjectionClassifier,
  recordGuardStep,
  recordPayloadSize,
  runClassifier,
  safeStringify,
  spotlight,
  validateToolBudget,
  type BudgetViolation,
  type ClassifierInput,
  type ClassifierVerdict,
  type GuardLike,
  type GuardStepLike,
  type HeuristicClassifierOptions,
  type ManifestAssessment,
  type ManifestTextSurface,
  type McpSecurityClassifier,
  type McpToolAnnotations,
  type SecuritySink,
  type SecuritySource,
  type SpotlightMethod,
  type SpotlightOptions,
  type ToolBudgetInput,
} from './security';
