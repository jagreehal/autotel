import { trace } from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';

/** The tracer autotel-edge installs, which carries the worker's span buffer. */
export function workerTracer(name = 'autotel-edge'): WorkerTracer {
  // SAFETY: autotel-edge registers its own TracerProvider, so every tracer the
  // API hands back in a worker is a WorkerTracer; the OTel API types it as the
  // base interface because it does not know which provider is installed.
  return trace.getTracer(name) as WorkerTracer;
}
