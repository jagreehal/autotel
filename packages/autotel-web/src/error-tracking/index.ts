import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { ErrorTrackingConfig, ExceptionMechanism } from './types';
import { buildExceptionList } from './exception-builder';
import { RateLimiter } from './rate-limiter';
import { isSuppressed } from './suppression';

export type {
  ErrorTrackingConfig,
  ExceptionList,
  ExceptionRecord,
  StackFrame,
  SuppressionRule,
  RateLimitConfig,
} from './types';

let isInitialized = false;
let rateLimiter = new RateLimiter();
let config: ErrorTrackingConfig = {};
let cleanupFns: (() => void)[] = [];

function hasPostHog(): boolean {
  const g = typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : undefined;
  return !!(g?.posthog && typeof (g.posthog as any).captureException === 'function');
}

function recordException(error: unknown, mechanismType: ExceptionMechanism['type']): void {
  const exceptionList = buildExceptionList(error, mechanismType, config.redactor);
  if (exceptionList.length === 0) return;

  const topException = exceptionList[exceptionList.length - 1];

  // Check suppression
  if (config.suppressionRules && isSuppressed(topException, config.suppressionRules)) {
    if (config.debug) {
      console.debug('[autotel-web] Suppressed exception:', topException.type, topException.value);
    }
    return;
  }

  // Check rate limit
  if (!rateLimiter.isAllowed(topException.type)) {
    if (config.debug) {
      console.debug('[autotel-web] Rate-limited exception:', topException.type);
    }
    return;
  }

  const tracer = trace.getTracer('autotel-web', '1.0.0');

  // Record on active span or create new one
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    activeSpan.recordException(normalizedError);
    activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: topException.value });
    activeSpan.setAttribute('exception.type', topException.type);
    activeSpan.setAttribute('exception.message', topException.value);
    activeSpan.setAttribute('exception.list', JSON.stringify(exceptionList));
    activeSpan.setAttribute('error.source', mechanismType);
  } else {
    tracer.startActiveSpan('unhandled_error', (span) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      span.recordException(normalizedError);
      span.setStatus({ code: SpanStatusCode.ERROR, message: topException.value });
      span.setAttribute('exception.type', topException.type);
      span.setAttribute('exception.message', topException.value);
      span.setAttribute('exception.list', JSON.stringify(exceptionList));
      span.setAttribute('error.source', mechanismType);
      span.end();
    });
  }

  if (config.debug) {
    console.debug('[autotel-web] Captured exception:', topException.type, topException.value);
  }
}

/**
 * Set up automatic error tracking.
 * Replaces the old setupErrorCapture().
 */
export function setupErrorTracking(cfg: ErrorTrackingConfig): void {
  if (typeof window === 'undefined') return;
  if (isInitialized) return;

  config = cfg;
  rateLimiter = new RateLimiter(cfg.rateLimit);

  const shouldDeferToPostHog = cfg.deferToPostHog !== false && hasPostHog();

  if (!shouldDeferToPostHog) {
    const onError = (event: ErrorEvent) => {
      const error = event.error != null ? event.error : new Error(event.message);
      recordException(error, 'onerror');
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      recordException(event.reason, 'onunhandledrejection');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    cleanupFns.push(
      () => window.removeEventListener('error', onError),
      () => window.removeEventListener('unhandledrejection', onRejection),
    );

    if (cfg.captureConsoleErrors) {
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        const error = args[0] instanceof Error ? args[0] : new Error(args.map(String).join(' '));
        recordException(error, 'console.error');
        originalConsoleError.apply(console, args);
      };
      cleanupFns.push(() => {
        console.error = originalConsoleError;
      });
    }
  }

  isInitialized = true;
  if (cfg.debug) {
    console.debug('[autotel-web] Error tracking initialized', {
      deferToPostHog: shouldDeferToPostHog,
      captureConsoleErrors: cfg.captureConsoleErrors ?? false,
    });
  }
}

/**
 * Manually capture an exception.
 * Use this for caught errors you want to track.
 */
export function captureException(error: unknown): void {
  recordException(error, 'manual');
}

/** @internal Reset for testing */
export function resetErrorTrackingForTesting(): void {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  isInitialized = false;
}
