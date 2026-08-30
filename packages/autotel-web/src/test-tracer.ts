/**
 * Span capture for tests. Not exported from the package — the filename is
 * outside vitest's collection glob, so it is a helper, not a suite.
 */
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

const exporter = new InMemorySpanExporter();
let registered = false;

/** Install a recording tracer provider and clear anything captured so far. */
export function captureSpans(): InMemorySpanExporter {
  if (!registered) {
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      }),
    );
    registered = true;
  }
  exporter.reset();
  return exporter;
}

/** Finished spans with the given name. */
export function spansNamed(name: string): ReadableSpan[] {
  return exporter.getFinishedSpans().filter((span) => span.name === name);
}
