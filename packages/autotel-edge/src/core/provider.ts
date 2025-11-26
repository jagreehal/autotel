/**
 * Tracer provider for edge environments
 */

import { trace } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { SpanProcessor, TracerConfig } from '@opentelemetry/sdk-trace-base';
import { WorkerTracer } from './tracer';
import { AsyncLocalStorageContextManager } from './context';

/**
 * WorkerTracerProvider - Registers tracer globally
 */
export class WorkerTracerProvider {
  private tracer: WorkerTracer;
  private contextManager: AsyncLocalStorageContextManager;

  constructor(spanProcessors: SpanProcessor[], resource: Resource) {
    this.tracer = new WorkerTracer(spanProcessors, resource);
    this.contextManager = new AsyncLocalStorageContextManager();
  }

  /**
   * Get the tracer instance
   */
  getTracer(_name: string, _version?: string, _config?: TracerConfig): WorkerTracer {
    return this.tracer;
  }

  /**
   * Register this provider as the global tracer
   */
  register(): void {
    // Enable context manager
    this.contextManager.enable();

    // Set tracer provider
    const provider = {
      getTracer: (_name: string, _version?: string) => this.tracer,
    };

    // @ts-ignore - OTel types
    trace.setGlobalTracerProvider(provider);
  }
}
