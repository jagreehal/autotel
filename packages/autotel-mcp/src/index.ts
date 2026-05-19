export { createApp, type App } from './app';
export type { TelemetryBackend } from './backends/telemetry';
export { createBackend, type BackendHandle } from './backends/factory';
export { loadConfig, type AppConfig } from './config';
// Query helpers reused by the CLI mirror — same input shapes the MCP tools
// validate, so CLI commands behave identically to their MCP counterparts.
export {
  toTraceSearchQuery,
  toSpanSearchQuery,
  toMetricSearchQuery,
  toLogSearchQuery,
  type TraceQueryInput,
  type SpanQueryInput,
  type MetricsQueryInput,
  type LogsQueryInput,
} from './tools/shared';
// Operations imported by the CLI mirror.
export {
  discoverServices,
  discoverTraceFields,
  discoverLogFields,
} from './modules/discovery';
export { detectAnomalies } from './modules/anomaly';
export { findRootCause } from './modules/correlator';
export {
  collectUsage,
  listModels,
  getModelStats,
  rankExpensiveTraces,
  rankSlowTraces,
  listToolUsage,
} from './modules/llm-analytics';
export {
  clearSemanticConventionCache,
  getSemanticConventionNamespace,
  listSemanticConventionNamespaces,
} from './modules/semantic-conventions';
export {
  scoreSpan,
  suggestInstrumentationFixes,
} from './modules/instrumentation';
export {
  validateOtlpReceiverConfig,
  suggestCollectorConfig,
} from './modules/collector-config';
export {
  getCollectorComponentReadme,
  getCollectorComponentSchema,
  listCollectorComponents,
  listCollectorVersions,
  refreshCollectorCatalog,
  resolveCollectorVersion,
  validateCollectorComponentConfig,
} from './modules/collector-catalog';
export {
  buildCapabilitiesText,
  buildInstrumentationGuide,
  buildCollectorGuide,
} from './modules/docs';
// pickErrorMessage is exported from tools/diagnosis for testing, reused here
// so the CLI find-errors command groups errors identically to the MCP tool.
export { pickErrorMessage } from './tools/diagnosis';
export * from './types';
