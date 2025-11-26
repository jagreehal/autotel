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
export { AsyncLocalStorageContextManager } from './core/context';
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
  type traceOptions,
  type TraceContext,
  type InstrumentOptions,
} from './functional';

// Types
export type {
  Trigger,
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
} from './types';

// Re-export OpenTelemetry APIs for convenience
export { context, propagation } from '@opentelemetry/api';

// Re-export common OpenTelemetry types
export type {
  Span,
  SpanContext,
  Tracer,
  Context,
} from '@opentelemetry/api';
