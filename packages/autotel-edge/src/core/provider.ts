/**
 * Tracer provider for edge environments
 */

import { context, trace } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { SpanProcessor, TracerConfig } from '@opentelemetry/sdk-trace-base';
import { WorkerTracer } from './tracer';
import { AsyncLocalStorageContextManager } from './context';

// `context.setGlobalContextManager()` is a one-shot global; guard so repeated
// `register()` calls (e.g. per-request worker init) don't spam OTel's
// "already registered" diagnostic.
let globalContextManagerRegistered = false;

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

    // Register it with the global OTel API so context — and the active span —
    // propagates across `await` boundaries. Without this the API uses a no-op
    // context manager, so `trace.getActiveSpan()` returns undefined after the
    // first await inside a handler/workflow step. That breaks any consumer that
    // resolves trace context from the active span (e.g. autotel-genai/audit
    // composing inside an instrumented fetch handler or Workflow step).
    if (!globalContextManagerRegistered) {
      globalContextManagerRegistered = context.setGlobalContextManager(
        this.contextManager,
      );
    }

    // Set tracer provider
    const provider = {
      getTracer: (_name: string, _version?: string) => this.tracer,
    };

    // @ts-ignore - OTel types
    trace.setGlobalTracerProvider(provider);
  }
}
