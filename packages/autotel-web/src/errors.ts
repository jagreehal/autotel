/**
 * Unhandled error capture for full mode
 *
 * Listens for window.onerror and unhandledrejection; records the exception
 * on the current active span or creates a short unhandled_error span so
 * errors are correlated with trace ID.
 */

import { trace } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';

export interface ErrorCaptureConfig {
  debug: boolean;
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(String(value));
  } catch {
    return new Error('Unknown error');
  }
}

export function setupErrorCapture(config: ErrorCaptureConfig): void {
  if (typeof window === 'undefined') return;

  const tracer = trace.getTracer('autotel-web', '1.0.0');

  function recordError(error: Error, source?: string): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.recordException(error);
      activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      if (config.debug) {
        console.debug('[autotel-web] Recorded error on active span:', error.message);
      }
    } else {
      tracer.startActiveSpan('unhandled_error', (span) => {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        if (source) {
          span.setAttribute('error.source', source);
        }
        span.setAttribute('exception.type', error.name);
        span.setAttribute('exception.message', error.message);
        span.end();
        if (config.debug) {
          console.debug('[autotel-web] Created unhandled_error span:', error.message);
        }
      });
    }
  }

  window.addEventListener('error', (event: ErrorEvent) => {
    const error = event.error != null ? normalizeError(event.error) : new Error(event.message);
    recordError(error, 'window.onerror');
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const error = normalizeError(event.reason);
    recordError(error, 'unhandledrejection');
  });
}
