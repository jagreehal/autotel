import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { ErrorTrackingConfig, ExceptionMechanism } from './types';
import { buildExceptionList } from './exception-builder';
import { readBreadcrumbs } from '../breadcrumbs';
import { fingerprintFrames } from './fingerprint';
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

/** The PostHog browser SDK, as this module uses it. */
interface PostHogLike {
  captureException?: (cause: unknown) => void;
}

function hasPostHog(): boolean {
  // SAFETY: posthog is installed on the page by a script tag, so it is not in
  // any type we control; only captureException is read, and only after this
  // probe finds it.
  const g = globalThis as { posthog?: PostHogLike };
  return !!(g.posthog && typeof g.posthog.captureException === 'function');
}

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
]);

function isLocalOrigin(): boolean {
  const hostname = globalThis.location?.hostname;
  if (!hostname) return false;
  // `.local` covers mDNS names phones use to reach a dev machine on the LAN,
  // which is still the same dev server.
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.local');
}

function recordException(
  error: unknown,
  mechanismType: ExceptionMechanism['type'],
): void {
  if (config.skipLocalhost && isLocalOrigin()) {
    if (config.debug) {
      console.debug('[autotel-web] Skipped exception on a local origin');
    }
    return;
  }

  const exceptionList = buildExceptionList(
    error,
    mechanismType,
    config.redactor,
  );
  if (exceptionList.length === 0) return;

  const topException = exceptionList[exceptionList.length - 1];

  // Check suppression
  if (
    config.suppressionRules &&
    isSuppressed(topException, config.suppressionRules)
  ) {
    if (config.debug) {
      console.debug(
        '[autotel-web] Suppressed exception:',
        topException.type,
        topException.value,
      );
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

  // Computed from the frames already parsed above, so the grouping decision
  // travels with the error instead of each backend re-deriving its own.
  const fingerprint = fingerprintFrames(
    topException.type,
    topException.value,
    topException.stacktrace?.frames,
  );

  // The trail leading in. An exception says where the code gave up; the steps
  // before it say what the person was doing, which is the half that reproduces.
  const breadcrumbs = readBreadcrumbs();
  const trail =
    breadcrumbs.length > 0 ? JSON.stringify(breadcrumbs) : undefined;

  const tracer = trace.getTracer('autotel-web', '1.0.0');

  // Record on active span or create new one
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    activeSpan.recordException(normalizedError);
    activeSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: topException.value,
    });
    activeSpan.setAttribute('exception.type', topException.type);
    activeSpan.setAttribute('exception.message', topException.value);
    activeSpan.setAttribute('exception.list', JSON.stringify(exceptionList));
    activeSpan.setAttribute('exception.fingerprint', fingerprint);
    activeSpan.setAttribute('error.source', mechanismType);
    if (trail) activeSpan.setAttribute('exception.breadcrumbs', trail);
  } else {
    tracer.startActiveSpan('unhandled_error', (span) => {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      span.recordException(normalizedError);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: topException.value,
      });
      span.setAttribute('exception.type', topException.type);
      span.setAttribute('exception.message', topException.value);
      span.setAttribute('exception.list', JSON.stringify(exceptionList));
      span.setAttribute('exception.fingerprint', fingerprint);
      span.setAttribute('error.source', mechanismType);
      if (trail) span.setAttribute('exception.breadcrumbs', trail);
      span.end();
    });
  }

  if (config.debug) {
    console.debug(
      '[autotel-web] Captured exception:',
      topException.type,
      topException.value,
    );
  }
}

/**
 * Set up automatic error tracking.
 * Replaces the old setupErrorCapture().
 */
export function setupErrorTracking(cfg: ErrorTrackingConfig): void {
  if (globalThis.window === undefined) return;
  if (isInitialized) return;

  config = cfg;
  rateLimiter = new RateLimiter(cfg.rateLimit);

  const shouldDeferToPostHog = cfg.deferToPostHog !== false && hasPostHog();

  if (!shouldDeferToPostHog) {
    const onError = (event: ErrorEvent) => {
      const error =
        event.error != null ? event.error : new Error(event.message);
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
        const error =
          args[0] instanceof Error
            ? args[0]
            : new Error(args.map(String).join(' '));
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
