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
  propagation,
  SpanKind,
  SpanStatusCode,
  type TextMapPropagator,
} from '@opentelemetry/api';
import type {
  Sampler,
  SpanExporter,
  SpanProcessor,
} from '@opentelemetry/sdk-trace';
import { StackContextManager, TracerProvider } from '@opentelemetry/sdk-trace';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { rememberRequestSpan } from './join';
import { urlTemplate } from './url-template';
import { PrivacyManager, type PrivacyConfig } from './privacy';
import { setupNetworkTimingObserver } from './network-timing';
import { setupUserInteractionInstrumentation } from './user-interaction';
import { setupErrorTracking, type ErrorTrackingConfig } from './error-tracking';
import { createStringRedactor } from './error-tracking/redact-values';
import { setupWebVitals } from './web-vitals';
import { setupLongTaskObserver } from './long-tasks';
import {
  browserResourceAttributes,
  releaseResourceAttributes,
  resetPageIdentityForTesting,
  setPageIdentity,
  type ReleaseConfig,
} from './browser-context';
import {
  collectBreadcrumbs,
  configureBreadcrumbs,
  type BreadcrumbsConfig,
} from './breadcrumbs';
import { setupEngagement } from './engagement';
import { setupFrustrationSignals, type FrustrationConfig } from './frustration';
import { captureConsoleAsLogs, type ConsoleLogsConfig } from './browser-logs';
import { emitEvent, setEventSink } from './emit-event';
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
import { isDevelopment } from './dev-mode';
import { createSessionRatioSampler, withoutResourceFetch } from './sampler';
import { exportProcessors, withoutExportRequests } from './full-export';
import {
  configureSession,
  endSessionOnUnload,
  getSessionAttributes,
  type SessionConfig,
} from './session';
import {
  getBaggageHeader,
  hasBaggage,
  isBaggageDestinationAllowed,
} from './baggage';
import { getIdentityAttributes } from './identity';
import {
  selfInstrumentationIgnoreUrls,
  VENDOR_TELEMETRY_URLS,
  ignoreUrlPatterns,
} from './otlp-endpoint';
import { propagationUrlPattern } from './propagate';

/**
 * Stamps session attributes in `onStart`, which is the only hook that can still
 * write to a span. Sitting first in the processor array means every later
 * processor — including whatever the host app passed as `spanProcessor` — sees
 * the attributes already there.
 */
function sessionSpanProcessor(withSession: boolean): SpanProcessor {
  return {
    onStart(span) {
      // Identity first: the session is the join key and is never overridden.
      const identity = getIdentityAttributes();
      if (identity) span.setAttributes(identity);
      const attributes = withSession ? getSessionAttributes() : undefined;
      if (attributes) span.setAttributes(attributes);
    },
    onEnd() {},
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

/**
 * The fetch and XHR instrumentations name a span after its method alone, so
 * every `GET` is one operation. Renaming it `{method} {url.template}` at start,
 * when an id segment was replaced, gives each endpoint its own name while
 * keeping ids out of it.
 */
function urlTemplateSpanProcessor(idPatterns?: RegExp[]): SpanProcessor {
  return {
    onStart(span) {
      if (span.kind !== SpanKind.CLIENT) return;
      const url = span.attributes['url.full'];
      const method = span.attributes['http.request.method'];
      if (!url || !method) return;
      let path: string;
      try {
        path = new URL(String(url), globalThis.location?.href).pathname;
      } catch {
        return;
      }
      const template = urlTemplate(path, idPatterns);
      // A path with no id in it may still hold a slug, an email or a token,
      // so only a path the patterns templated goes into the name.
      if (template === path) return;
      span.setAttribute('url.template', template);
      span.updateName(`${String(method)} ${template}`);
    },
    onEnd() {},
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

export interface AutotelWebFullConfig extends ReleaseConfig {
  /** Service name for the browser application */
  service: string;

  /**
   * OTLP endpoint URL for trace export (e.g. https://api.example.com/v1/traces).
   * If not set, no export (spans still created; use spanProcessor for custom export).
   */
  endpoint?: string;

  /**
   * Treat every request to the collector's origin as telemetry, not only the
   * OTLP paths.
   *
   * Set this when the collector serves more than OTLP - autotel's devtools
   * collector serves its own UI and query API beside `/v1/traces` - so the
   * widget that displays the traces is itself a fetch from this page. Tracing
   * that makes the tool a source of the data it displays: every poll of the
   * trace list writes another trace to the list.
   *
   * Off by default, because nothing in the URL can tell a dedicated collector
   * from an OTLP endpoint proxied through the application's own server, and
   * getting that wrong silences the requests the page exists to make. The
   * page's own origin is never excluded, whatever this says.
   *
   * @example
   * ```typescript
   * init({
   *   service: 'my-spa',
   *   endpoint: 'http://localhost:4848',  // devtools collector, nothing else
   *   collectorOwnsOrigin: true,
   * });
   * ```
   *
   * @default false
   */
  collectorOwnsOrigin?: boolean;

  /**
   * Requests never to trace or propagate on, besides the collector's own and
   * the known telemetry vendors' uploads (Datadog, Sentry, PostHog Cloud, New
   * Relic), which are always excluded. A RegExp is matched against the full
   * URL; a string is a URL prefix, resolved against the page, so
   * `'/rum-proxy'` covers a vendor SDK proxied through your own origin.
   */
  ignoreUrls?: (string | RegExp)[];

  /**
   * More path segments to treat as ids. Fetch and XHR spans are named
   * `{method} {url.template}`, with each id segment replaced by `:id`. MongoDB
   * ObjectIds, UUIDs and numbers are recognised already; each pattern here is
   * tested against one whole segment.
   *
   * @example
   * ```ts
   * urlIdPatterns: [/^ord_[a-z0-9]+$/]   // GET /orders/ord_9f2k -> GET /orders/:id
   * ```
   */
  urlIdPatterns?: RegExp[];

  /**
   * Replaces the export pipeline: when set, `endpoint` exports no spans and
   * `spanExporters` are ignored. For a processor that should run *beside* the
   * OTLP export, use `spanExporters` (exporters) or `spanEnrichers`
   * (decorators) instead.
   */
  spanProcessor?: SpanProcessor;

  /**
   * More destinations for spans, alongside `endpoint`. Each is batched like the
   * OTLP export, so a Zipkin exporter, an OTLP/protobuf exporter or a
   * `ConsoleSpanExporter` while developing is one line:
   *
   * ```ts
   * import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace';
   * initFull({ service: 'web', endpoint, spanExporters: [new ConsoleSpanExporter()] });
   * ```
   *
   * A request an exporter starts while exporting is not traced, so an export
   * never becomes a span of its own. One that defers its send past `export()`
   * is not caught: add its URL to `ignoreUrls`.
   *
   * Ignored, with a warning, when `spanProcessor` is set.
   */
  spanExporters?: SpanExporter[];

  /**
   * How trace context is written to outgoing requests.
   *
   * W3C `traceparent` by default. Pass another propagator when the backend
   * expects a different format, e.g. B3:
   *
   * ```ts
   * import { B3Propagator } from '@opentelemetry/propagator-b3';
   * initFull({ service: 'web', endpoint, propagator: new B3Propagator() });
   * ```
   *
   * Which requests carry it is still decided by `propagateTo` and `privacy`;
   * `baggage` is written separately and is unaffected.
   */
  propagator?: TextMapPropagator;

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
   * Options are shared with lean `init()`; full mode takes its session from a
   * join (`autotel-web/join`) rather than an `id` callback.
   *
   * @default { timeoutMs: 1_800_000 }
   */
  session?: false | Omit<SessionConfig, 'id'>;

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

  /**
   * Keep the one `resourceFetch` span per script, stylesheet and image that
   * document-load instrumentation records under `documentLoad`.
   *
   * Off in development by default: a dev server serves every module as its
   * own request, so one page load becomes hundreds of spans that describe the
   * bundler rather than the app. `documentLoad` and `documentFetch` stay.
   * Development is `process.env.NODE_ENV !== 'production'` where a bundler
   * substituted one, else a page served from localhost.
   *
   * @default true in production, false in development
   */
  captureResourceTiming?: boolean;

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
   * Options for Web Vitals, passed through to web-vitals. reportAllChanges
   * (default false for stability); reportSoftNavs reports vitals per SPA route
   * change where the browser supports soft navigations (default false).
   */
  webVitals?: { reportAllChanges?: boolean; reportSoftNavs?: boolean };

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

  /**
   * Cross-origin destinations allowed to receive `traceparent` and `baggage`.
   * Same-origin always propagates; everything else is opt-in, because an
   * unexpected header makes the browser preflight and a server that does not
   * allow it rejects the request. Spans are recorded either way.
   *
   * Same field, same meaning, as lean mode's `propagateTo`.
   */
  propagateTo?: string[];

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
let provider: TracerProvider | undefined;
let originalFetch: typeof fetch | undefined;

/**
 * Initialize full browser tracing (spans + optional export).
 *
 * Call once, client-side only. Uses OpenTelemetry TracerProvider; no Zone.js.
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
  const release = releaseResourceAttributes(config);
  const resource = resourceFromAttributes({
    'service.name': service,
    ...release,
    ...browserResourceAttributes(),
  });

  configureSession(config.session ?? {});

  const spanProcessors: SpanProcessor[] = [];
  spanProcessors.push(sessionSpanProcessor(config.session !== false));
  spanProcessors.push(urlTemplateSpanProcessor(config.urlIdPatterns));
  // Ahead of whatever exports below: onEnd runs in array order, so an enricher
  // placed after the exporter would decorate a span that has already gone.
  if (config.spanEnrichers?.length) {
    spanProcessors.push(...config.spanEnrichers);
  }
  if (config.spanProcessor) {
    // It replaces the export pipeline, so exporters given beside it would be
    // dropped without a word.
    if (config.spanExporters?.length) {
      console.warn(
        '[autotel-web/full] spanExporters are ignored when spanProcessor is set; pass one or the other.',
      );
    }
    spanProcessors.push(config.spanProcessor);
  } else {
    const exportTo = exportProcessors(config.endpoint, config.spanExporters);
    spanProcessors.push(...exportTo);
    if (exportTo.length === 0 && config.debug) {
      // No export; spans are still created, e.g. for propagation only.
      console.log(
        '[autotel-web/full] No endpoint, spanExporters or spanProcessor; spans will not be exported.',
      );
    }
  }

  // Read before the provider is built: a rate that only applies on the next
  // visit is not much of a kill switch.
  const remote = config.remoteConfigUrl ? cachedRemoteConfig() : undefined;
  const sampleRate = remote?.sampleRate ?? config.sampleRate;
  const configured =
    config.sampler ??
    (sampleRate != null ? createSessionRatioSampler(sampleRate) : undefined);
  const captureResourceTiming =
    config.captureResourceTiming ?? !isDevelopment();
  const withoutResources = captureResourceTiming
    ? configured
    : withoutResourceFetch(configured);
  const sampler =
    !config.spanProcessor && config.spanExporters?.length
      ? withoutExportRequests(withoutResources)
      : withoutResources;

  provider = new TracerProvider({
    resource,
    spanProcessors,
    ...(sampler && { sampler }),
  });
  otelTrace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(
    config.propagator ?? new W3CTraceContextPropagator(),
  );
  // No Zone.js, so async context is best-effort.
  context.setGlobalContextManager(new StackContextManager().enable());

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
  const selfUrls = [
    ...selfInstrumentationIgnoreUrls(
      config.endpoint,
      window.location?.origin,
      config.collectorOwnsOrigin,
    ),
    ...VENDOR_TELEMETRY_URLS,
    ...ignoreUrlPatterns(config.ignoreUrls, window.location?.origin),
  ];

  // Cross-origin destinations that may receive the header. The Web SDK is
  // already same-origin-only without this, which is the behaviour lean mode now
  // matches; `privacy.allowedOrigins` is the deprecated spelling, and a
  // cross-origin baggage destination is one of ours by declaration.
  // As patterns, not raw strings: `propagateTraceHeaderCorsUrls` is matched
  // against the whole URL, where a string entry has to equal it outright and a
  // bare substring regex also matches in the path. See `propagationUrlPattern`.
  const propagateTo = [
    ...(config.propagateTo ?? []),
    ...(config.privacy?.allowedOrigins ?? []),
    ...(config.baggage?.allowedOrigins ?? []),
  ].map((origin) => propagationUrlPattern(origin));

  if (config.captureFetch !== false) {
    const fetchOptions: ConstructorParameters<typeof FetchInstrumentation>[0] =
      {};
    if (propagateTo.length) {
      fetchOptions.propagateTraceHeaderCorsUrls = propagateTo;
    }
    if (selfUrls.length) {
      fetchOptions.ignoreUrls = selfUrls;
    }
    // So an error built from this response can find the request's trace
    // after the span has ended: see `spanContextOf`.
    fetchOptions.applyCustomAttributesOnSpan = (span, _request, result) =>
      rememberRequestSpan(result, span.spanContext());
    instrumentations.push(new FetchInstrumentation(fetchOptions));
  }
  if (config.captureXHR !== false) {
    const xhrOptions: ConstructorParameters<
      typeof XMLHttpRequestInstrumentation
    >[0] = {};
    if (propagateTo.length) {
      xhrOptions.propagateTraceHeaderCorsUrls = propagateTo;
    }
    if (selfUrls.length) {
      xhrOptions.ignoreUrls = selfUrls;
    }
    // axios rejects with `error.request` set to this XHR, after the span has
    // ended; this is how that error finds its trace.
    xhrOptions.applyCustomAttributesOnSpan = (span, xhr) =>
      rememberRequestSpan(xhr, span.spanContext());
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
      // Logs and events carry the same release as the spans.
      resource: release,
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

  const gate = baggageGate(
    config.baggage?.allowedOrigins ?? [],
    config.privacy ? new PrivacyManager(config.privacy) : undefined,
    // The same exclusions the instrumentations get: a request that is never
    // traced is never propagated on either, baggage included.
    selfUrls,
  );
  wrapFetchForBaggage(gate, config.debug);
  wrapXhrForBaggage(gate, config.debug);

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
      reportSoftNavs: config.webVitals?.reportSoftNavs ?? false,
      debug: config.debug ?? false,
      ...(stringRedactor && { redactor: stringRedactor }),
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
    // `true`, or switched on remotely: no local overrides.
    const localFrustration =
      config.captureFrustration && config.captureFrustration !== true
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
    const consoleConfig: ConsoleLogsConfig =
      config.captureConsoleLogs === true
        ? {}
        : { ...config.captureConsoleLogs };
    if (stringRedactor) consoleConfig.redactor = stringRedactor;
    captureConsoleAsLogs(consoleConfig);
  }

  if (config.breadcrumbs) {
    const options = config.breadcrumbs === true ? {} : config.breadcrumbs;
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
  setPageIdentity({
    service,
    ...(config.endpoint !== undefined && { endpoint: config.endpoint }),
    resource: release,
  });
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

/**
 * The `baggage` header a request to `url` may carry, or `undefined`.
 *
 * Both gates, the same way lean mode decides it. The destination allowlist
 * answers "is this our own backend"; the privacy configuration answers "may we
 * send context about this visitor at all" — Do Not Track, Global Privacy
 * Control, blocked origins. Baggage carries business context off the page, so
 * a `privacy` setting that held for traceparent and not for this would be a
 * setting that does not mean what it says.
 */
type BaggageGate = (url: string) => string | undefined;

function baggageGate(
  allowedOrigins: readonly string[],
  privacy: PrivacyManager | undefined,
  excluded: readonly RegExp[],
): BaggageGate {
  return (url) => {
    const origin = globalThis.location?.origin ?? '';
    if (isExcluded(url, origin, excluded)) return undefined;
    if (
      !hasBaggage() ||
      (privacy && !privacy.shouldInjectTraceparent(url)) ||
      !isBaggageDestinationAllowed(url, origin, allowedOrigins)
    ) {
      return undefined;
    }
    return getBaggageHeader();
  };
}

function wrapFetchForBaggage(gate: BaggageGate, debug?: boolean): void {
  const inner = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = fetchUrl(input);
    const header = gate(url);
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

let originalXhr:
  Pick<XMLHttpRequest, 'open' | 'send' | 'setRequestHeader'> | undefined;

/**
 * The same header on XMLHttpRequest, which axios uses. The XHR
 * instrumentation propagates `traceparent` only; `setBaggage()` entries live
 * in this package, not in the OpenTelemetry context it injects from.
 */
function wrapXhrForBaggage(gate: BaggageGate, debug?: boolean): void {
  if (globalThis.XMLHttpRequest === undefined || originalXhr) return;
  const proto = XMLHttpRequest.prototype;
  const original = {
    open: proto.open,
    send: proto.send,
    setRequestHeader: proto.setRequestHeader,
  };
  originalXhr = original;
  const urls = new WeakMap<XMLHttpRequest, string>();
  const ownBaggage = new WeakSet<XMLHttpRequest>();

  // SAFETY: the wrapper takes exactly `open`'s parameters and returns what the
  // original returns; the assertion only restores the overloads a rest
  // parameter cannot spell.
  proto.open = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest['open']>
  ) {
    urls.set(this, String(args[1]));
    ownBaggage.delete(this);
    // SAFETY: forwards the caller's own arguments to the method it called.
    return (original.open as (...a: unknown[]) => void).apply(this, args);
  } as XMLHttpRequest['open'];

  proto.setRequestHeader = function (
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    if (name.toLowerCase() === 'baggage') ownBaggage.add(this);
    return original.setRequestHeader.call(this, name, value);
  };

  proto.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const url = urls.get(this);
    const header = url && !ownBaggage.has(this) ? gate(url) : undefined;
    if (url && header) {
      try {
        original.setRequestHeader.call(this, 'baggage', header);
        if (debug) {
          console.log(
            '[autotel-web/full] Injected baggage on XHR:',
            url,
            header,
          );
        }
      } catch {
        // Not opened, or already sent: the request goes as the app made it.
      }
    }
    return original.send.call(this, body);
  };
}

/**
 * Whether a URL is one the page must not propagate on: our collector, another
 * telemetry SDK's uploads, or the app's `ignoreUrls`. Matched on the resolved
 * URL, since the patterns are absolute and a fetch is often relative.
 */
function isExcluded(
  url: string,
  origin: string,
  excluded: readonly RegExp[],
): boolean {
  let absolute = url;
  try {
    absolute = new URL(url, origin || undefined).href;
  } catch {
    // Matched as written.
  }
  return excluded.some((pattern) => pattern.test(absolute));
}

function fetchUrl(input: RequestInfo | URL): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- discriminating fetch's own `RequestInfo | URL` argument; `instanceof Request` would miss one from another realm
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** A value that settles later, whatever produced it. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a type guard over whatever the app's callback returned; taking `unknown` is what makes it the parse
function isThenable(value: unknown): value is PromiseLike<unknown> {
  // SAFETY: this is the thenable test itself - `then` is probed for before
  // anything treats the value as a promise.
  return (
    value instanceof Object &&
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the definition of a thenable; `instanceof Promise` misses other promise libraries
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/** What `recordException` accepts: an Error, or a description of one. */
function toException(cause: unknown): Error | string {
  return cause instanceof Error ? cause : String(cause);
}

/**
 * The span `span()` hands its callback. Held by the callback rather than looked
 * up as the active span, so it still names the right span after an `await`:
 * without Zone.js the active context does not survive one.
 */
export interface SpanHandle {
  setAttribute: (key: string, value: string | number | boolean) => void;
  /**
   * Record an event that happened during this span, as a log record carrying
   * the span's trace and span id (the Logs API model, not `Span.addEvent`).
   * Needs an `endpoint`, like every browser event.
   */
  event: (
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ) => void;
  /** Only for a synchronous callback that ends early; a returned promise ends the span itself. */
  end: () => void;
}

/**
 * Create a span with the current context (full mode).
 *
 * The span ends when `fn` returns, or when the promise it returns settles; a
 * throw or rejection marks it as an error.
 *
 * @example
 * ```ts
 * await span('load-user', (s) =>
 *   fetch('/api/user').then((res) => s.event('user.loaded', { status: res.status })),
 * );
 * ```
 */
export function span<T>(name: string, fn: (s: SpanHandle) => T): T {
  const tracer = otelTrace.getTracer('autotel-web', '1.0.0');
  // SAFETY: startActiveSpan is typed to return whatever its callback returns,
  // but only through an overload set that loses T here; the callback below
  // returns exactly the T that `fn` produced.
  return tracer.startActiveSpan(name, (s) => {
    try {
      const result = fn({
        setAttribute: (key, value) => s.setAttribute(key, value),
        event: (eventName, attributes) => {
          const { traceId, spanId } = s.spanContext();
          emitEvent(eventName, attributes ?? {}, { traceId, spanId });
        },
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
export { createSessionRatioSampler } from './sampler';
export { identify, clearIdentity, type IdentityAttributes } from './identity';
export type {
  SessionConfig,
  SessionEnd,
  SessionEndReason,
  SessionStart,
} from './session';

/**
 * Reset full initialization state (for testing).
 * @internal
 */
export function resetFullForTesting(): void {
  isFullInitialized = false;
  resetPageIdentityForTesting();
  if (provider) {
    provider.shutdown();
    provider = undefined;
  }
  // Shutting the provider down does not unregister it. Without this, a second
  // initFull() in the same process is refused by the API and keeps the first
  // provider's processors — so a suite silently tests the previous test's
  // configuration.
  otelTrace.disable();
  // Same refusal for the propagator: a test of `propagator` would otherwise
  // inherit whichever one the first initFull() registered.
  propagation.disable();
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
  if (originalXhr) {
    Object.assign(XMLHttpRequest.prototype, originalXhr);
    originalXhr = undefined;
  }
}
