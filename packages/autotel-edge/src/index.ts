/**
 * autotel-edge
 *
 * Vendor-agnostic OpenTelemetry for edge runtimes
 * Foundation for Cloudflare Workers, Vercel Edge, Netlify Edge, Deno Deploy
 *
 * Bundle size: ~20KB minified (~8KB gzipped)
 *
 * @example Quick Start
 * ```typescript
 * import { trace, init } from 'autotel-edge'
 *
 * init({
 *   service: { name: 'my-edge-function' },
 *   exporter: { url: process.env.OTEL_ENDPOINT }
 * })
 *
 * export const handler = trace(async (request: Request) => {
 *   return new Response('Hello World')
 * })
 * ```
 */

// Core exports
export { SpanImpl } from './core/span';
export { WorkerTracer, withNextSpan } from './core/tracer';
export { OTLPExporter } from './core/exporter';
export { AsyncLocalStorageContextManager, ensureGlobalContextManager } from './core/context';
export { WorkerTracerProvider } from './core/provider';
export { Buffer } from './core/buffer';
export {
  parseConfig,
  createInitialiser,
  getActiveConfig,
  setConfig,
  type Initialiser,
} from './core/config';

// Functional API (PRIMARY - zero-boilerplate tracing)
export {
  trace,
  withTracing,
  instrument as instrumentFunctions,
  span,
  enterSpan,
  type traceOptions,
  type TraceContext,
  type InstrumentOptions,
} from './functional';

// Native span bridge (seam for platform-native tracers, e.g. Cloudflare).
// Runtime adapter packages install a NativeTracer; span()/trace() route to it.
export {
  withNativeTracer,
  getActiveNativeTracer,
  createNativeTraceContext,
  createNativeSpanShim,
  type NativeTracer,
  type NativeSpanHandle,
} from './core/native-bridge';
export type { NativeTracingMode } from './types';

export {
  getExecutionLogger,
  type ExecutionLogger,
  type ExecutionLoggerOptions,
  type ExecutionLogSnapshot,
  type ForkLifecycle,
  type ForkOptions,
} from './execution-logger';

export {
  defineConfig,
  composeSubscribers,
  composePostProcessors,
  composeSpanProcessors,
} from './composition';
export {
  definePlugin,
  createPluginRunner,
  getEmptyPluginRunner,
} from './plugin-runner';
export {
  matchesRoutePattern,
  shouldInstrumentPath,
  getServiceForPath,
  runMiddlewareFinishPipeline,
} from './middleware-toolkit';

// Types
export type {
  Trigger,
  DOConstructorTrigger,
  WorkflowTrigger,
  EdgeConfig,
  ResolvedEdgeConfig,
  ServiceConfig,
  OTLPExporterConfig,
  ExporterConfig,
  SamplingConfig,
  InstrumentationOptions,
  ResolveConfigFn,
  ConfigurationOption,
  PostProcessorFn,
  TailSampleFn,
  LocalTrace,
  TraceFlushableSpanProcessor,
  InitialSpanInfo,
  HandlerInstrumentation,
  EdgeSubscriber,
  ReadableSpan,
  DataSafetyConfig,
  RouteServiceConfig,
} from './types';
export type {
  EdgePlugin,
  PluginRunner,
  PluginHookContexts,
  DefaultPluginContexts,
  PluginRunnerOptions,
} from './plugin-runner';
export type {
  RouteFilterOptions,
  MiddlewareFinishContext,
  MiddlewarePipelineOptions,
} from './middleware-toolkit';

// Re-export OpenTelemetry APIs for convenience
export { context, propagation } from '@opentelemetry/api';

// Re-export common OpenTelemetry types
export type {
  Span,
  SpanContext,
  Tracer,
  Context,
} from '@opentelemetry/api';

// Error parsing helper for frontend/API consumers in edge runtimes
export { parseError, type ParsedError } from './parse-error';
