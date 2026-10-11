/**
 * The OTLP-mode tracer provider, registered once per isolate by whichever
 * wrapper runs first: a Worker handler, or a Workflow.
 */
import { propagation } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ResolvedEdgeConfig } from 'autotel-edge';
import { WorkerTracerProvider } from 'autotel-edge';
import { instrumentGlobalCache } from './global/cache';
import { instrumentGlobalFetch } from './global/fetch';
import { workerTracer } from './tracer.js';

let providerInitialized = false;

/**
 * Initialize the tracer provider
 */
export function initProvider(config: ResolvedEdgeConfig): void {
  if (providerInitialized) return;

  // Install global instrumentations
  if (config.instrumentation.instrumentGlobalFetch) {
    instrumentGlobalFetch();
  }
  if (config.instrumentation.instrumentGlobalCache) {
    instrumentGlobalCache();
  }

  // Set up propagator
  propagation.setGlobalPropagator(config.propagator);

  // Create resource
  const resource = resourceFromAttributes({
    'service.name': config.service.name,
    'service.version': config.service.version,
    'service.namespace': config.service.namespace,
    'cloud.provider': 'cloudflare',
    'cloud.platform': 'cloudflare.workers',
    'telemetry.sdk.name': 'autotel-edge',
    'telemetry.sdk.language': 'js',
  });

  // Create and register provider
  const provider = new WorkerTracerProvider(config.spanProcessors, resource);
  provider.register();

  // Set head sampler on tracer
  const tracer = workerTracer('autotel-edge');
  tracer.setHeadSampler(config.sampling.headSampler);

  providerInitialized = true;
}
