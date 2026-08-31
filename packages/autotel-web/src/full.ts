/**
 * Full browser tracing with OpenTelemetry SDK
 *
 * Single install: npm install autotel-web. Import from 'autotel-web/full'.
 * No Zone.js - uses default context manager. Async context propagation is best-effort.
 *
 * @see https://github.com/open-telemetry/semantic-conventions/issues/3385 (http.client.network_timing)
 */

import {
  trace as otelTrace,
  context,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { Sampler, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  BatchSpanProcessor,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PrivacyManager, type PrivacyConfig } from './privacy';
import { setupNetworkTimingObserver } from './network-timing';
import { setupUserInteractionInstrumentation } from './user-interaction';
import { setupErrorTracking, type ErrorTrackingConfig } from './error-tracking';
import { createStringRedactor } from './error-tracking/redact-values';
import { setupWebVitals } from './web-vitals';
import { setupLongTaskObserver } from './long-tasks';
import { browserResourceAttributes } from './browser-context';
import {
  collectBreadcrumbs,
  configureBreadcrumbs,
  type BreadcrumbsConfig,
} from './breadcrumbs';
import { setupEngagement } from './engagement';
import { setupFrustrationSignals, type FrustrationConfig } from './frustration';
import { captureConsoleAsLogs, type ConsoleLogsConfig } from './browser-logs';
import { setEventSink } from './emit-event';
import {
  configureExporter,
  flushSpans,
  recordEvent,
  setRawFetch,
} from './span-exporter';
import {
  applyRemoteSuppression,
  applyRemoteFrustrationToggles,
  cachedRemoteConfig,
  refreshRemoteConfig,
  resolveCaptureToggles,
} from './remote-config';
import { createSessionRatioSampler } from './sampler';
import {
  configureSession,
  endSessionOnUnload,
  getSessionAttributes,
} from './session';
import {
  getBaggageHeader,
  hasBaggage,
  isBaggageDestinationAllowed,
} from './baggage';
import {
  normaliseOtlpEndpoint,
  selfInstrumentationIgnoreUrls,
} from './otlp-endpoint';

/**
 * Stamps session attributes in `onStart`, which is the only hook that can still
 * write to a span. Sitting first in the processor array means every later
 * processor — including whatever the host app passed as `spanProcessor` — sees
 * the attributes already there.
 */
function sessionSpanProcessor(): SpanProcessor {
  return {
    onStart(span) {
      const attributes = getSessionAttributes();
      if (attributes) span.setAttributes(attributes);
    },
    onEnd() {},
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

export interface AutotelWebFullConfig {
  /** Service name for the browser application */
  service: string;

  /**
   * OTLP endpoint URL for trace export (e.g. https://api.example.com/v1/traces).
   * If not set, no export (spans still created; use spanProcessor for custom export).
   */
  endpoint?: string;

  /**
   * Custom span processor(s). If provided, used instead of default BatchSpanProcessor + OTLP exporter.
   * When endpoint is set, this is ignored.
   */
  spanProcessor?: SpanProcessor;

  /**
   * Processors that decorate spans on the way out rather than export them.
   *
   * Separate from `spanProcessor` on purpose: that one *replaces* the pipeline,
   * so passing an enricher there silently switches off the export that was just
   * configured. These are added to the pipeline, and ordered ahead of the
   * exporter so an attribute they add is one the exporter actually sends.
   *
   * ```ts
   * import { posthogCompatibility } from 'autotel-posthog';
   * initFull({ service: 'web', endpoint, spanEnrichers: [posthogCompatibility()] });
   * ```
   */
  spanEnrichers?: SpanProcessor[];

  /**
   * Session identity stamped on every span as `session.id`, so a visit's
   * navigation, fetches, vitals, clicks and errors can be reassembled into one
   * journey. Tab-scoped random UUID, no user-derived data; a gap longer than
   * `timeoutMs` starts a new session linked by `session.previous_id`.
   *
   * Pass `false` to emit no session attributes.
   *
   * @default { timeoutMs: 1_800_000 }
   */
  session?:
    | false
    | {
        timeoutMs?: number;
        /** Emit `session.start` / `session.end` events. @default false */
        emitEvents?: boolean;
      };

  /**
   * Sample rate 0–1. Default 1.0. Use e.g. 0.1 in production.
   *
   * Decided by hashing the session id, so a sampled session is sampled whole.
   * Sampling per span instead would keep a tenth of every visit and leave none
   * of them reconstructable. Overridden by `remoteConfigUrl` when that supplies
   * a rate.
   */
  sampleRate?: number;

  /**
   * Custom sampler. If set, `sampleRate` is ignored — for every signal, not
   * just spans.
   *
   * A sampler decides about spans, and there is nothing to ask it about a log
   * record or an event, so those are exported unsampled. Use `sampleRate`
   * instead where events and logs need sampling too.
   */
  sampler?: Sampler;

  /** Enable document load / navigation spans. @default true */
  captureNavigation?: boolean;

  /** Enable fetch instrumentation. @default true */
  captureFetch?: boolean;

  /** Enable XMLHttpRequest instrumentation. @default true */
  captureXHR?: boolean;

  /**
   * Emit http.client.network_timing events from Resource Timing API.
   * @default true
   */
  captureNetworkTiming?: boolean;

  /**
   * Copy original HTTP span attributes onto network_timing event for backends that need them.
   * @default false
   */
  copyHttpSpanAttributesToEvent?: boolean;

  /** Optional click capture, emitted as `app.widget.click` events. */
  userInteraction?: {
    enabled: boolean;
    /** CSS selectors for elements to track (e.g. ['button', '[data-track]']). Default: ['button', 'a'] */
    selectors?: string[];
  };

  /**
   * Record unhandled errors (window.onerror, unhandledrejection) on active span or create unhandled_error span.
   * @default true
   */
  captureErrors?: boolean;

  /**
   * Capture Web Vitals (LCP, INP, CLS, FCP, TTFB), one `browser.web_vital`
   * event per metric.
   * @default true
   */
  captureWebVitals?: boolean;

  /**
   * Options for Web Vitals. reportAllChanges: pass through to web-vitals (default false for stability).
   */
  webVitals?: { reportAllChanges?: boolean };

  /**
   * Capture long tasks (main thread blocking >= 50ms) as `app.jank` events.
   * Opt-in; can be noisy.
   * @default false
   */
  captureLongTasks?: boolean;

  /**
   * Advanced error tracking configuration.
   * When captureErrors is true (default), this configures rate limiting, suppression, etc.
   */
  errorTracking?: Omit<ErrorTrackingConfig, 'debug'>;

  /**
   * Report clicks that achieved nothing (`dead`) and clicks repeated in
   * frustration (`rage`) as `app.widget.click.frustration` events.
   *
   * The one browser signal a tracer cannot produce for itself: a click that
   * does nothing runs no code, so the trace is empty exactly where the user is
   * stuck. Off by default — it installs a document-wide MutationObserver.
   *
   * @default false
   */
  captureFrustration?: boolean | Omit<FrustrationConfig, 'debug'>;

  /**
   * Report how far down each page anyone actually got, as a
   * `browser.page_engagement` event on page hide and route change.
   *
   * @default false
   */
  captureEngagement?: boolean;

  /**
   * Keep a bounded trail of what happened before an error — clicks, console
   * output, whatever you add via `addBreadcrumb` — and attach it to the
   * exception as `exception.breadcrumbs`.
   *
   * @default false
   */
  breadcrumbs?:
    boolean | (BreadcrumbsConfig & { console?: boolean; clicks?: boolean });

  /**
   * Export `console.*` output as OpenTelemetry log records, under the
   * instrumentation scope `console`.
   *
   * Distinct from `breadcrumbs`: this feeds the log pipeline, breadcrumbs
   * attach the same output to an exception for whoever reads the error.
   * Enabling both is reasonable.
   *
   * Lean-mode only for now — it rides the hand-rolled OTLP transport in
   * `span-exporter`, so it needs `endpoint` to be set.
   *
   * @default false
   */
  captureConsoleLogs?: boolean | ConsoleLogsConfig;

  /**
   * URL of a JSON file that can change capture settings without a release —
   * sampling rate, which signals are on, which errors to suppress.
   *
   * Served from wherever the app already is; autotel has nothing to serve it
   * from. The last good copy is cached and applied synchronously on the next
   * visit, so a failed fetch changes nothing.
   */
  remoteConfigUrl?: string;

  /** Redact PII from error messages and stack traces before export. Preset or custom config. */
  attributeRedactor?:
    | 'default'
    | 'strict'
    | 'pci-dss'
    | {
        valuePatterns?: Array<{
          name: string;
          pattern: RegExp;
          replacement?: string;
        }>;
        replacement?: string;
      };

  /** Privacy controls (origin filtering, DNT, GPC). Applied to which requests get traced. */
  privacy?: PrivacyConfig;

  /**
   * W3C `baggage` header injection for `setBaggage()` (from `autotel-web/baggage`).
   *
   * Same-origin requests receive the header. Cross-origin destinations need
   * `allowedOrigins`. This is the same fail-closed rule as lean `init()`.
   */
  baggage?: {
    allowedOrigins?: string[];
  };

  /** Enable debug logging. @default false */
  debug?: boolean;
}

let isFullInitialized = false;
let provider: WebTracerProvider | undefined;
let originalFetch: typeof fetch | undefined;

/**
 * Initialize full browser tracing (spans + optional export).
 *
 * Call once, client-side only. Uses OpenTelemetry WebTracerProvider; no Zone.js.
 *
 * @example
 * ```ts
 * import { initFull } from 'autotel-web/full'
 * initFull({
 *   service: 'my-app',
 *   endpoint: 'https://api.example.com/v1/traces',
 *   sampleRate: 0.1,
 *   captureNetworkTiming: true,
 *   userInteraction: { enabled: true, selectors: ['button', '[data-track]'] }
 * })
 * ```
 */
export function initFull(config: AutotelWebFullConfig): void {
  if (globalThis.window === undefined) {
    return;
  }
  if (isFullInitialized) {
    if (config.debug) {
      console.warn('[autotel-web/full] Already initialized. Skipping.');
    }
    return;
  }

  const service = config.service ?? 'browser';
  // Canonical `browser.*` context, so a span can answer "only on mobile
  // Safari?" without anyone re-deriving it from a user-agent string.
  const resource = resourceFromAttributes({
    'service.name': service,
    ...browserResourceAttributes(),
  });

  configureSession(config.session ?? {});

  const spanProcessors: SpanProcessor[] = [];
  if (config.session !== false) {
    spanProcessors.push(sessionSpanProcessor());
  }
  // Ahead of whatever exports below: onEnd runs in array order, so an enricher
  // placed after the exporter would decorate a span that has already gone.
  if (config.spanEnrichers?.length) {
    spanProcessors.push(...config.spanEnrichers);
  }
  if (config.spanProcessor) {
    spanProcessors.push(config.spanProcessor);
  } else if (config.endpoint) {
    const exporter = new OTLPTraceExporter({
      // Accept a bare origin as init() does; without this a bare origin POSTs
      // to the collector root and 404s.
      url: normaliseOtlpEndpoint(config.endpoint),
    });
    spanProcessors.push(
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 1000,
        maxExportBatchSize: 64,
      }),
    );
  } else {
    // No export; still create spans (e.g. for propagation only)
    if (config.debug) {
      console.log(
        '[autotel-web/full] No endpoint or spanProcessor; spans will not be exported.',
      );
    }
  }

  // Read before the provider is built: a rate that only applies on the next
  // visit is not much of a kill switch.
  const remote = config.remoteConfigUrl ? cachedRemoteConfig() : undefined;
  const sampleRate = remote?.sampleRate ?? config.sampleRate;
  const sampler =
    config.sampler ??
    (sampleRate != null ? createSessionRatioSampler(sampleRate) : undefined);

  provider = new WebTracerProvider({
    resource,
    spanProcessors,
    ...(sampler && { sampler }),
  });
  provider.register({
    propagator: new W3CTraceContextPropagator(),
    // No contextManager: use default (no Zone.js). Async context is best-effort.
  });

  const instrumentations: Array<
    | DocumentLoadInstrumentation
    | FetchInstrumentation
    | XMLHttpRequestInstrumentation
  > = [];

  if (config.captureNavigation !== false) {
    instrumentations.push(new DocumentLoadInstrumentation());
  }
  // Never trace the exporter's own requests. Without this, each export POST
  // creates a span, which is exported, which creates another span -- a
  // feedback loop that floods the collector and starves real spans out of the
  // batch buffer.
  const selfUrls = selfInstrumentationIgnoreUrls(config.endpoint);

  if (config.captureFetch !== false) {
    const fetchOptions: ConstructorParameters<typeof FetchInstrumentation>[0] =
      {};
    if (config.privacy?.allowedOrigins?.length) {
      fetchOptions.propagateTraceHeaderCorsUrls =
        config.privacy.allowedOrigins.map(
          (o) => new RegExp(escapeRegex(o), 'i'),
        );
    }
    if (selfUrls.length) {
      fetchOptions.ignoreUrls = selfUrls;
    }
    instrumentations.push(new FetchInstrumentation(fetchOptions));
  }
  if (config.captureXHR !== false) {
    const xhrOptions: ConstructorParameters<
      typeof XMLHttpRequestInstrumentation
    >[0] = {};
    if (config.privacy?.allowedOrigins?.length) {
      xhrOptions.propagateTraceHeaderCorsUrls = config.privacy.allowedOrigins;
    }
    if (selfUrls.length) {
      xhrOptions.ignoreUrls = selfUrls;
    }
    instrumentations.push(new XMLHttpRequestInstrumentation(xhrOptions));
  }

  if (!originalFetch) {
    originalFetch = globalThis.fetch.bind(globalThis);
  }

  // Events and console output are log records, and the Web SDK here carries
  // traces only. Borrow the hand-rolled OTLP transport for the log half —
  // `signals: ['logs']` keeps it from exporting spans the SDK already sends.
  if (config.endpoint !== undefined) {
    setRawFetch(originalFetch);
    configureExporter(service, config.endpoint, config.debug, {
      signals: ['logs'],
      // The same rate the trace provider samples on, hashed on the same session
      // id — so a sampled visit keeps its spans, its events and its logs, and
      // an unsampled one costs nothing on any signal.
      //
      // Skipped entirely when a custom `sampler` is supplied, because then the
      // documented contract is that `sampleRate` is ignored. Honouring it here
      // anyway would split the signals: an always-on sampler with `sampleRate:
      // 0` would export spans and silently drop every event.
      ...(config.sampler == null && sampleRate != null && { sampleRate }),
    });
    setEventSink(recordEvent);
    // The same last chance lean mode takes. Events and console logs sit in the
    // 2-second batch until something sends them, and a page being navigated
    // away from has no next tick — so the end of every visit, `session.end`
    // included, would be exactly the part that never arrives.
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      endSessionOnUnload();
      flushSpans({ beacon: true });
    });
  }

  registerInstrumentations({
    instrumentations,
  });

  wrapFetchForBaggage(
    config.baggage?.allowedOrigins ?? [],
    config.privacy ? new PrivacyManager(config.privacy) : undefined,
    config.debug,
  );

  if (config.captureNetworkTiming !== false) {
    setupNetworkTimingObserver({
      copyHttpSpanAttributes: config.copyHttpSpanAttributesToEvent ?? false,
      debug: config.debug ?? false,
    });
  }

  if (config.userInteraction?.enabled) {
    setupUserInteractionInstrumentation({
      selectors: config.userInteraction.selectors ?? ['button', 'a'],
      debug: config.debug ?? false,
    });
  }

  const stringRedactor = config.attributeRedactor
    ? createStringRedactor(config.attributeRedactor)
    : undefined;

  if (config.captureErrors !== false) {
    setupErrorTracking({
      debug: config.debug ?? false,
      ...config.errorTracking,
      // Remote rules are added to the local ones, never substituted for them.
      suppressionRules: applyRemoteSuppression(
        config.errorTracking?.suppressionRules,
        remote,
      ),
      ...(stringRedactor && { redactor: stringRedactor }),
    });
  }

  if (config.captureWebVitals !== false) {
    setupWebVitals({
      reportAllChanges: config.webVitals?.reportAllChanges ?? false,
      debug: config.debug ?? false,
    });
  }

  if (config.captureLongTasks === true) {
    setupLongTaskObserver({ debug: config.debug ?? false });
  }

  // Refreshed behind the page, for the next visit.
  if (config.remoteConfigUrl) {
    void refreshRemoteConfig(config.remoteConfigUrl, {
      fetchImpl: originalFetch,
    });
  }

  const toggles = resolveCaptureToggles(
    {
      frustration:
        config.captureFrustration !== undefined &&
        config.captureFrustration !== false,
      engagement: config.captureEngagement === true,
    },
    remote,
  );

  if (toggles.frustration) {
    const localFrustration =
      typeof config.captureFrustration === 'object'
        ? config.captureFrustration
        : {};
    setupFrustrationSignals({
      debug: config.debug ?? false,
      ...applyRemoteFrustrationToggles(localFrustration, toggles),
    });
  }

  if (toggles.engagement) {
    setupEngagement({ debug: config.debug ?? false });
  }

  if (config.captureConsoleLogs) {
    captureConsoleAsLogs({
      ...(typeof config.captureConsoleLogs === 'object'
        ? config.captureConsoleLogs
        : {}),
      ...(stringRedactor && { redactor: stringRedactor }),
    });
  }

  if (config.breadcrumbs) {
    const options =
      typeof config.breadcrumbs === 'object' ? config.breadcrumbs : {};
    configureBreadcrumbs({
      ...options,
      ...(stringRedactor && { redactor: stringRedactor }),
    });
    collectBreadcrumbs({
      console: options.console ?? true,
      clicks: options.clicks ?? true,
    });
  }

  isFullInitialized = true;
  if (config.debug) {
    console.log('[autotel-web/full] Initialized', {
      service,
      captureNavigation: config.captureNavigation !== false,
      captureFetch: config.captureFetch !== false,
      captureXHR: config.captureXHR !== false,
      captureNetworkTiming: config.captureNetworkTiming !== false,
      captureErrors: config.captureErrors !== false,
      captureWebVitals: config.captureWebVitals !== false,
      captureLongTasks: config.captureLongTasks === true,
      userInteraction: config.userInteraction?.enabled ?? false,
      captureFrustration: toggles.frustration,
      captureEngagement: toggles.engagement,
      breadcrumbs: Boolean(config.breadcrumbs),
      captureConsoleLogs: Boolean(config.captureConsoleLogs),
      sampleRate: sampleRate ?? 1,
    });
  }
}

/**
 * The headers this request will actually be sent with.
 *
 * `fetch(request, init)` does not merge: where `init.headers` is given it
 * replaces the Request's headers wholesale. Anything decided from the Request
 * alone is therefore thrown away by the caller's `init`, so the effective set
 * has to be built first and handed back through `init`.
 */
function effectiveHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
): Headers {
  if (init?.headers !== undefined) return new Headers(init.headers);
  if (input instanceof Request) return new Headers(input.headers);
  return new Headers();
}

function wrapFetchForBaggage(
  allowedOrigins: readonly string[],
  privacy: PrivacyManager | undefined,
  debug?: boolean,
): void {
  const inner = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = fetchUrl(input);
    const origin = globalThis.location?.origin ?? '';
    // Both gates, the same way lean mode decides it. The destination allowlist
    // answers "is this our own backend"; the privacy configuration answers
    // "may we send context about this visitor at all" — Do Not Track, Global
    // Privacy Control, blocked origins. Baggage carries business context off
    // the page, so a `privacy` setting that held for traceparent and not for
    // this would be a setting that does not mean what it says.
    if (
      !hasBaggage() ||
      (privacy && !privacy.shouldInjectTraceparent(url)) ||
      !isBaggageDestinationAllowed(url, origin, allowedOrigins)
    ) {
      return inner(input, init);
    }
    const header = getBaggageHeader();
    if (!header) return inner(input, init);

    const headers = effectiveHeaders(input, init);
    if (headers.has('baggage')) return inner(input, init);
    headers.set('baggage', header);
    if (debug) {
      console.log('[autotel-web/full] Injected baggage on fetch:', url, header);
    }
    return inner(input, { ...init, headers });
  };
}

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A value that settles later, whatever produced it. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  // SAFETY: this is the thenable test itself - `then` is probed for before
  // anything treats the value as a promise.
  return (
    value instanceof Object &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/** What `recordException` accepts: an Error, or a description of one. */
function toException(cause: unknown): Error | string {
  return cause instanceof Error ? cause : String(cause);
}

/**
 * Create a span with the current context (full mode).
 */
export function span<T>(
  name: string,
  fn: (s: {
    setAttribute: (k: string, v: string | number | boolean) => void;
    end: () => void;
  }) => T,
): T {
  const tracer = otelTrace.getTracer('autotel-web', '1.0.0');
  // SAFETY: startActiveSpan is typed to return whatever its callback returns,
  // but only through an overload set that loses T here; the callback below
  // returns exactly the T that `fn` produced.
  return tracer.startActiveSpan(name, (s) => {
    try {
      const result = fn({
        setAttribute: (k, v) => s.setAttribute(k, v),
        end: () => s.end(),
      });
      if (isThenable(result)) {
        result.then(
          () => s.end(),
          (cause: unknown) => {
            s.recordException(toException(cause));
            s.setStatus({ code: SpanStatusCode.ERROR });
            s.end();
          },
        );
        return result;
      }
      s.end();
      return result;
    } catch (cause) {
      s.recordException(toException(cause));
      s.setStatus({ code: SpanStatusCode.ERROR });
      s.end();
      throw cause;
    }
  }) as T;
}

/**
 * Set attribute on the active span (full mode).
 */
export function setAttribute(
  key: string,
  value: string | number | boolean,
): void {
  const activeSpan = otelTrace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute(key, value);
  }
}

/**
 * Add an event to the active span (full mode).
 */
export function addEvent(
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  const activeSpan = otelTrace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent(name, attributes);
  }
}

/**
 * Run a function with the given context (for manual async propagation in full mode).
 */
export function runWithContext<T>(
  ctx: ReturnType<typeof context.active>,
  fn: () => T,
): T {
  return context.with(ctx, fn);
}

/** Re-export for full mode API */
export {
  trace,
  getActiveContext,
  getTraceparent,
  extractContext,
} from './functional';
export type { TraceContext } from './functional';
export { captureException } from './error-tracking';

/**
 * Reset full initialization state (for testing).
 * @internal
 */
export function resetFullForTesting(): void {
  isFullInitialized = false;
  if (provider) {
    provider.shutdown();
    provider = undefined;
  }
  // Shutting the provider down does not unregister it. Without this, a second
  // initFull() in the same process is refused by the API and keeps the first
  // provider's processors — so a suite silently tests the previous test's
  // configuration.
  otelTrace.disable();
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
}
