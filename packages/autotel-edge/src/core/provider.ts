/**
 * Tracer provider for edge environments
 */

import { trace } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { SpanProcessor, TracerConfig } from '@opentelemetry/sdk-trace-base';
import { WorkerTracer } from './tracer';
import { ensureGlobalContextManager } from './context';

/**
 * WorkerTracerProvider - Registers tracer globally
 */
export class WorkerTracerProvider {
  private tracer: WorkerTracer;

  constructor(spanProcessors: SpanProcessor[], resource: Resource) {
    this.tracer = new WorkerTracer(spanProcessors, resource);
  }

  /**
   * Get the tracer instance
   */
  getTracer(_name: string, _version?: string, _config?: TracerConfig): WorkerTracer {
    return this.tracer;
  }

  /**
   * Register this provider as the global tracer.
   *
   * Registers the global context manager so context — and the active span —
   * propagates across `await` boundaries (without it the API uses a no-op
   * manager and `trace.getActiveSpan()` returns undefined after the first
   * await), then installs the tracer provider.
   */
  register(): void {
    ensureGlobalContextManager();

    const provider = {
      getTracer: (_name: string, _version?: string) => this.tracer,
    };

    // @ts-ignore - OTel types
    trace.setGlobalTracerProvider(provider);
  }
}
