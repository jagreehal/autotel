/**
 * Configuration system for autotel-edge
 */

import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { ParentBasedSampler, AlwaysOnSampler } from '@opentelemetry/sdk-trace-base';
import { context as api_context, createContextKey, type Context } from '@opentelemetry/api';
import type {
  EdgeConfig,
  ResolvedEdgeConfig,
  ConfigurationOption,
  Trigger,
  ParentRatioSamplingConfig,
} from '../types';
import { isSpanProcessorConfig } from '../types';
import { OTLPExporter } from './exporter';
import { TailSamplingSpanProcessor } from './spanprocessor';

/**
 * Type for config initialization function
 */
export type Initialiser = (env: any, trigger: Trigger) => ResolvedEdgeConfig;

/**
 * Context key for storing config (isolates config per-request)
 */
const CONFIG_KEY = createContextKey('autotel-edge-config');

/**
 * Get the currently active config from context
 *
 * This reads the config from the active context, ensuring each request
 * has its own isolated config even when multiple requests are in-flight.
 */
export function getActiveConfig(): ResolvedEdgeConfig | null {
  const value = api_context.active().getValue(CONFIG_KEY) as
    | ResolvedEdgeConfig
    | null
    | undefined;
  return value ?? null;
}

/**
 * Set the active config in context
 *
 * Returns a new context with the config stored. This context should be
 * used with api_context.with() to ensure the config is isolated per-request.
 *
 * @example
 * ```typescript
 * const config = parseConfig({ service: { name: 'my-service' } });
 * const context = setConfig(config);
 *
 * api_context.with(context, () => {
 *   // Config is available here via getActiveConfig()
 * });
 * ```
 */
export function setConfig(config: ResolvedEdgeConfig): Context {
  return api_context.active().setValue(CONFIG_KEY, config);
}

/**
 * Parse and validate configuration
 */
export function parseConfig(config: EdgeConfig): ResolvedEdgeConfig {
  // Parse head sampler
  const headSampler =
    config.sampling?.headSampler ??
    new ParentBasedSampler({
      root: new AlwaysOnSampler(),
    });

  const parsedHeadSampler =
    typeof headSampler === 'object' && 'ratio' in headSampler
      ? createParentRatioSampler(headSampler)
      : headSampler;

  // Parse tail sampler (default: keep sampled or error traces)
  const tailSampler =
    config.sampling?.tailSampler ??
    ((traceInfo) => {
      const localRootSpan = traceInfo.localRootSpan;
      const ctx = localRootSpan.spanContext();
      // Keep if sampled or if root span has error
      return (ctx.traceFlags & 1) === 1 || localRootSpan.status.code === 2; // SAMPLED flag | ERROR status
    });

  // Parse exporter - use TailSamplingSpanProcessor when tail sampler is present
  const spanProcessors = isSpanProcessorConfig(config)
    ? Array.isArray(config.spanProcessors)
      ? config.spanProcessors
      : [config.spanProcessors]
    : [
        // Use TailSamplingSpanProcessor to enable tail sampling
        new TailSamplingSpanProcessor(
          typeof config.exporter === 'object' && 'url' in config.exporter
            ? new OTLPExporter(config.exporter)
            : config.exporter,
          config.postProcessor,
          tailSampler, // Wire up the tail sampler!
        ),
      ];

  // Build resolved config
  const resolved: ResolvedEdgeConfig = {
    service: config.service,
    handlers: {
      fetch: config.handlers?.fetch ?? {},
    },
    fetch: {
      includeTraceContext: config.fetch?.includeTraceContext ?? true,
    },
    postProcessor: config.postProcessor ?? ((spans) => spans),
    sampling: {
      headSampler: parsedHeadSampler,
      tailSampler,
    },
    spanProcessors,
    propagator: config.propagator ?? new W3CTraceContextPropagator(),
    instrumentation: {
      instrumentGlobalFetch: config.instrumentation?.instrumentGlobalFetch ?? true,
      instrumentGlobalCache: config.instrumentation?.instrumentGlobalCache ?? false,
      disabled: config.instrumentation?.disabled ?? false,
    },
    subscribers: config.subscribers ?? [],
  };

  return resolved;
}

/**
 * Create a parent-based ratio sampler
 */
function createParentRatioSampler(config: ParentRatioSamplingConfig) {
  const { ratio, acceptRemote = true } = config;

  // Simple ratio sampler
  const ratioSampler = {
    shouldSample: () => ({
      decision: Math.random() < ratio ? 1 : 0, // RECORD_AND_SAMPLED : NOT_RECORD
      attributes: {},
    }),
    toString: () => `ParentRatioSampler{ratio=${ratio}}`,
  };

  if (acceptRemote) {
    return new ParentBasedSampler({ root: ratioSampler as any });
  }

  return ratioSampler;
}

/**
 * Create a config initializer function
 */
export function createInitialiser(config: ConfigurationOption): Initialiser {
  if (typeof config === 'function') {
    return (env, trigger) => {
      const conf = parseConfig(config(env, trigger));
      return conf;
    };
  } else {
    const parsed = parseConfig(config);
    return () => parsed;
  }
}
