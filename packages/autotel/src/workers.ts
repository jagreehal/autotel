/**
 * Workers compatibility entrypoint for the `autotel` package.
 *
 * Goal: keep `autotel` as the package users install, while routing to the
 * Cloudflare-safe implementation surface (`autotel-cloudflare`) at import time.
 */

import { createInitialiser, type EdgeConfig } from 'autotel-cloudflare';

/**
 * Node-like init shim for workers.
 * Keeps familiar `init({ ... })` ergonomics for users coming from `autotel`.
 */
export function init(config: EdgeConfig) {
  return createInitialiser(config);
}

// Re-export Cloudflare-safe functional API and helpers.
export {
  trace,
  span,
  withTracing,
  instrumentFunctions as instrumentFunction,
  parseError,
  getExecutionLogger,
  type TraceContext,
  type InstrumentOptions,
  type ExecutionLogger,
  type ExecutionLoggerOptions,
  type ExecutionLogSnapshot,
} from 'autotel-cloudflare';

// Re-export Cloudflare-first wrappers and helpers for best DX.
export {
  instrument,
  wrapModule,
  wrapDurableObject,
  instrumentDO,
  instrumentWorkflow,
  instrumentBindings,
  instrumentKV,
  instrumentR2,
  instrumentD1,
  instrumentServiceBinding,
  instrumentAI,
  instrumentVectorize,
  instrumentHyperdrive,
  instrumentQueueProducer,
  instrumentAnalyticsEngine,
  instrumentImages,
  instrumentRateLimiter,
  instrumentBrowserRendering,
  getRequestLogger,
  getQueueLogger,
  getWorkflowLogger,
  getActorLogger,
  createWorkersLogger,
  instrumentGlobalFetch,
  instrumentGlobalCache,
} from 'autotel-cloudflare';

// Common Cloudflare extras that are typically imported from subpaths.
export {
  SamplingPresets,
  createAdaptiveTailSampler,
  createRandomTailSampler,
  createErrorOnlyTailSampler,
  createSlowOnlyTailSampler,
  createCustomTailSampler,
  combineTailSamplers,
} from 'autotel-cloudflare/sampling';

export {
  createEdgeLogger,
  runWithLogLevel,
  getEdgeTraceContext,
  getActiveLogLevel,
  type EdgeLogger,
  type EdgeLoggerOptions,
} from 'autotel-cloudflare/logger';

export {
  createEdgeSubscribers,
  getEdgeSubscribers,
  getEventName,
  type EdgeSubscribers,
  type CreateEdgeSubscribersOptions,
  type EdgeDispatchOptions,
  type SubscriberDeliveryMode,
} from 'autotel-cloudflare/events';
