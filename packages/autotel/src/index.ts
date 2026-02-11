/**
 * autotel - Simplified OpenTelemetry instrumentation
 *
 * @example Minimal setup
 * ```typescript
 * import { init, trace, track } from 'autotel'
 *
 * init({ service: 'my-app' })
 *
 * export const createUser = trace(ctx => async (data: CreateUserData) => {
 *   track('user.signup', { userId: data.id, plan: data.plan })
 * })
 * ```
 *
 * @example With events
 * ```typescript
 * import { init, trace, track } from 'autotel'
 * import { PostHogSubscriber } from 'autotel-subscribers'
 *
 * init({
 *   service: 'my-app',
 *   subscribers: [new PostHogSubscriber({ apiKey: '...' })]
 * })
 *
 * export const createUser = trace(ctx => async (data: CreateUserData) => {
 *   track('user.signup', { userId: data.id })
 * })
 * ```
 */

// Core initialization
export { init, type AutotelConfig } from './init';

// Baggage span processor
export {
  BaggageSpanProcessor,
  type BaggageSpanProcessorOptions,
} from './baggage-span-processor';

// Filtering span processor
export {
  FilteringSpanProcessor,
  type SpanFilterPredicate,
  type FilteringSpanProcessorOptions,
} from './filtering-span-processor';

// Span name normalizer
export {
  SpanNameNormalizingProcessor,
  NORMALIZER_PATTERNS,
  NORMALIZER_PRESETS,
  type SpanNameNormalizerFn,
  type SpanNameNormalizerPreset,
  type SpanNameNormalizerConfig,
  type SpanNameNormalizingProcessorOptions,
} from './span-name-normalizer';

// Attribute redacting processor
export {
  AttributeRedactingProcessor,
  REDACTOR_PATTERNS,
  REDACTOR_PRESETS,
  createRedactedSpan,
  type AttributeRedactorFn,
  type AttributeRedactorPreset,
  type AttributeRedactorConfig,
  type AttributeRedactingProcessorOptions,
  type ValuePatternConfig,
} from './attribute-redacting-processor';

// Functional API (re-export for convenience)
export type {
  TraceContext,
  SpanOptions,
  WithNewContextOptions,
  WithBaggageOptions,
  InstrumentOptions,
} from './functional';
export {
  trace,
  instrument,
  withTracing,
  span,
  withNewContext,
  withBaggage,
  ctx,
} from './functional';

// Operation context (for advanced usage)
export type { OperationContext } from './operation-context';
export {
  getOperationContext,
  runInOperationContext,
} from './operation-context';

// Global track function
export { track, getEventQueue } from './track';

// Correlation ID utilities
export {
  getCorrelationId,
  getOrCreateCorrelationId,
  generateCorrelationId,
  runWithCorrelationId,
  setCorrelationId,
  setCorrelationIdInBaggage,
  CORRELATION_ID_BAGGAGE_KEY,
} from './correlation-id';

// Graceful shutdown
export { flush, shutdown } from './shutdown';

// Re-export sampling strategies
export {
  type Sampler,
  type SamplingContext,
  AlwaysSampler,
  NeverSampler,
  RandomSampler,
  AdaptiveSampler,
  UserIdSampler,
  createLinkFromHeaders,
  extractLinksFromBatch,
} from './sampling';

// Events API
export { Event, getEvents, resetEvents, type EventsOptions } from './event';

// Metrics API
export {
  Metric,
  getMetrics,
  resetMetrics,
  type MetricsOptions,
} from './metric';

// Meter helpers for custom metrics
export {
  getMeter,
  createCounter,
  createHistogram,
  createUpDownCounter,
  createObservableGauge,
} from './metric-helpers';

// Tracer helpers for custom spans
export {
  getTracer,
  getActiveSpan,
  getActiveContext,
  runWithSpan,
  finalizeSpan,
  createDeterministicTraceId,
  flattenMetadata,
} from './trace-helpers';

// Isolated tracer provider support (advanced - for library authors)
export {
  setAutotelTracerProvider,
  getAutotelTracerProvider,
  getAutotelTracer,
} from './tracer-provider';

// Semantic convention helpers
export {
  traceLLM,
  traceDB,
  traceHTTP,
  traceMessaging,
  type LLMConfig,
  type DBConfig,
  type HTTPConfig,
  type MessagingConfig,
} from './semantic-helpers';

// Re-export events types
export type {
  EventSubscriber,
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
} from './event-subscriber';

// Re-export OpenTelemetry APIs for convenience
// (Users shouldn't need to import @opentelemetry/api directly)
// Note: OTel's trace is exported as 'otelTrace' to avoid naming conflict with autotel's trace()
// Plugin developers can also access it directly: import { otelTrace } from 'autotel'
export {
  context,
  propagation,
  SpanStatusCode,
  trace as otelTrace,
} from '@opentelemetry/api';

// Re-export common semantic-convention keys/builders for library instrumentation
export {
  HTTPAttributes,
  ServiceAttributes,
  URLAttributes,
  httpRequestHeaderAttribute,
  httpResponseHeaderAttribute,
} from './semantic-conventions';

// Re-export common OpenTelemetry types and utilities
// This allows plugins and apps to use OTel without needing separate @opentelemetry/api installation

// Semantic attribute builders and utilities
// Provides autocomplete-first attribute construction with automatic PII redaction
// and deprecation warnings
export {
  attrs,
  setUser,
  setSession,
  setDevice,
  httpServer,
  httpClient,
  dbClient,
  mergeServiceResource,
  identify,
  request,
  setError,
  setException,
  mergeAttrs,
  safeSetAttributes,
  validateAttribute,
  autoRedactPII,
  type AttributeGuardrails,
  type AttributePolicy,
  type UserAttrs,
  type SessionAttrs,
  type DeviceAttrs,
  type HTTPServerAttrs,
  type HTTPClientAttrs,
  type DBAttrs,
  type ServiceAttrs,
  type NetworkAttrs,
  type ErrorAttrs,
  type ExceptionAttrs,
  type FeatureFlagAttrs,
  type MessagingAttrs,
  type CloudAttrs,
  type ServerAddressAttrs,
  type URLAttrs,
  type PeerAttrs,
  type ProcessAttrs,
  type ContainerAttrs,
  type K8sAttrs,
  type FaaSAttrs,
  type ThreadAttrs,
  type GenAIAttrs,
  type RPCAttrs,
  type GraphQLAttrs,
  type ClientAttrs,
  type DeploymentAttrs,
  type OTelAttrs,
  type CodeAttrs,
  type TLSAttrs,
} from './attributes';

// Re-export common OpenTelemetry types and utilities
// This allows plugins and apps to use OTel without needing separate @opentelemetry/api installation
export type {
  Span,
  SpanContext,
  Tracer,
  Context,
  Link as SpanLink,
  TextMapSetter,
  TextMapGetter,
} from '@opentelemetry/api';
export { SpanKind, ROOT_CONTEXT } from '@opentelemetry/api';
// Note: trace exported from functional.ts, context/propagation/SpanStatusCode already exported above

// Export typed baggage helper
export { defineBaggageSchema } from './trace-context';

// Messaging helpers for event-driven architectures
export {
  traceProducer,
  traceConsumer,
  type ProducerConfig,
  type ConsumerConfig,
  type ProducerContext,
  type ConsumerContext,
  type MessagingSystem,
  type MessagingOperation,
  type LagMetricsConfig,
} from './messaging';

// Safe baggage propagation with guardrails
export {
  createSafeBaggageSchema,
  BusinessBaggage,
  type SafeBaggageOptions,
  type BaggageFieldDefinition,
  type BaggageFieldType,
  type BaggageError,
  type SafeBaggageSchema,
  type BusinessBaggageValues,
} from './business-baggage';

// Workflow and saga tracing
export {
  traceWorkflow,
  traceStep,
  getCurrentWorkflowContext,
  isInWorkflow,
  type WorkflowConfig,
  type StepConfig,
  type WorkflowContext,
  type StepContext,
  type WorkflowStatus,
  type StepStatus,
} from './workflow';
