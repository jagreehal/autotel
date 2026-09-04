/**
 * Minimal browser SDK initialization
 *
 * Patches fetch() and XMLHttpRequest to automatically inject W3C traceparent headers.
 * NO OpenTelemetry dependencies - just native browser APIs.
 *
 * Bundle size: ~2-5KB gzipped
 */

import { createTraceparent, parseTraceparent } from './traceparent';
import { PrivacyManager, PrivacyConfig, getDenialReason } from './privacy';
import { setEventSink } from './emit-event';
import {
  configureExporter,
  recordEvent,
  setRawFetch,
  recordSpan,
  flushSpans,
  isConfigured,
  resetForTesting as resetExporter,
} from './span-exporter';
import { configureSession, endSessionOnUnload } from './session';
import {
  setBaggage as setBaggageInternal,
  clearBaggage,
  getBaggageEntries,
  getBaggageHeader,
  hasBaggage,
  isBaggageDestinationAllowed,
  resetBaggageForTesting,
} from './baggage';

export interface AutotelWebConfig {
  /**
   * Service name for the browser application
   * Used only for logging/debugging - not sent in headers
   */
  service: string;

  /**
   * Enable debug logging to console
   * @default false
   */
  debug?: boolean;

  /**
   * Enable automatic traceparent injection on fetch calls
   * @default true
   */
  instrumentFetch?: boolean;

  /**
   * Enable automatic traceparent injection on XMLHttpRequest
   * @default true
   */
  instrumentXHR?: boolean;

  /**
   * OTLP endpoint for exporting browser spans.
   * When set, browser spans are sent via sendBeacon so the traceparent
   * spanId exists as a real span in the collector.
   * Use '' (empty string) for same-origin (requires /v1/traces proxy).
   */
  endpoint?: string;

  /**
   * Privacy controls for traceparent header injection
   *
   * Configure origin filtering and privacy signal respecting (DNT, GPC)
   * to ensure compliance with GDPR, CCPA, and user privacy preferences.
   *
   * @example Basic origin filtering
   * ```typescript
   * {
   *   privacy: {
   *     allowedOrigins: ['api.myapp.com'],  // Only inject on API calls
   *     respectDoNotTrack: true              // Respect user's DNT setting
   *   }
   * }
   * ```
   *
   * @example Block third-party analytics
   * ```typescript
   * {
   *   privacy: {
   *     blockedOrigins: ['analytics.google.com', 'facebook.com']
   *   }
   * }
   * ```
   */
  privacy?: PrivacyConfig;

  /**
   * Business-context baggage propagated end-to-end as a W3C `baggage` header.
   *
   * Set values at runtime with {@link setBaggage} (e.g. after login or a tenant
   * switch); they are injected on every instrumented same-origin request and
   * tagged onto every browser-recorded span. On the backend, autotel's
   * `BaggageSpanProcessor` (`init({ baggage: '' })` for bare keys, or
   * `baggage: true` for `baggage.`-prefixed keys) copies them onto server spans.
   *
   * **Fail-closed:** baggage is sent only to same-origin requests unless a
   * destination is explicitly listed in `allowedOrigins`. This keeps
   * customer-identifying values (e.g. `tenant.id`) from leaking to third-party
   * origins. Baggage never travels wider than traceparent.
   *
   * @example
   * ```typescript
   * init({
   *   service: 'my-spa',
   *   endpoint: 'https://collector.example.com',
   *   baggage: { allowedOrigins: ['api.example.com'] },
   * });
   * setBaggage({ 'tenant.id': 'acme' });
   * ```
   */
  baggage?: {
    /**
     * Initial baggage entries, applied during init() before any request fires.
     * Use this for context known at startup (e.g. tenant from the subdomain).
     */
    initial?: Record<string, string>;

    /**
     * Cross-origin destinations permitted to receive the baggage header.
     * Same-origin is always allowed; everything else is fail-closed.
     * Substring-matched, same convention as `privacy.allowedOrigins`.
     */
    allowedOrigins?: string[];
  };

  /**
   * Session identity stamped on every browser span as `session.id`, so spans
   * from one visit can be reassembled into a journey.
   *
   * The id is a random UUID held in `sessionStorage` — tab-scoped, nothing
   * derived from the person, and it identifies a visit rather than a visitor.
   * A gap longer than `timeoutMs` starts a new session and links it to the old
   * one via `session.previous_id` on the first span.
   *
   * Pass `false` to emit no session attributes at all.
   *
   * Where another SDK on the page already owns a session, hand its id in via
   * `id` and autotel carries that instead of minting one, so spans and that
   * SDK's own records key on the same value:
   *
   * ```ts
   * import { posthogSessionId } from 'autotel-posthog';
   * init({ service: 'web', session: { id: posthogSessionId } });
   * ```
   *
   * @default { timeoutMs: 1_800_000 }
   */
  /**
   * Fraction of sessions to export, 0..1. Default 1.
   *
   * Hashed on `session.id`, so a sampled visit is kept whole — and applied to
   * spans, logs and events alike, since a visit whose events survive but whose
   * spans do not is unreadable either way. With `session: false` there is no
   * key to be consistent about and the draw is per record.
   */
  sampleRate?: number;

  session?:
    | false
    | {
        timeoutMs?: number;
        id?: () => string | undefined;
        /**
         * Emit `session.start` / `session.end` events, so session count and session
         * duration are direct queries rather than something a backend has to infer
         * by grouping every span it has.
         *
         * @default false
         */
        emitEvents?: boolean;
      };
}

let isInitialized = false;
let config: AutotelWebConfig | undefined;
let privacyManager: PrivacyManager | undefined;
let originalFetch: typeof window.fetch | undefined;
let originalXHROpen: typeof XMLHttpRequest.prototype.open | undefined;
let originalXHRSetRequestHeader:
  typeof XMLHttpRequest.prototype.setRequestHeader | undefined;
let originalXHRSend: typeof XMLHttpRequest.prototype.send | undefined;

/**
 * Initialize autotel-web
 *
 * Patches fetch() and XMLHttpRequest to auto-inject traceparent headers.
 *
 * **SSR-safe:** Safe to call in SSR environments (checks for window).
 * **Call once:** Subsequent calls are ignored.
 *
 * @example
 * ```typescript
 * import { init } from 'autotel-web'
 *
 * init({ service: 'my-frontend-app' })
 *
 * // Now all fetch/XHR calls include traceparent headers!
 * fetch('/api/users')  // <-- traceparent header automatically injected
 * ```
 *
 * @example With React (client-only)
 * ```typescript
 * import { useEffect } from 'react'
 * import { init } from 'autotel-web'
 *
 * function App() {
 *   useEffect(() => {
 *     init({ service: 'my-spa' })
 *   }, [])
 *
 *   return <div>...</div>
 * }
 * ```
 */
export function init(userConfig: AutotelWebConfig): void {
  // SSR-safe: do nothing on the server
  if (globalThis.window === undefined) {
    return;
  }

  if (isInitialized) {
    if (userConfig.debug) {
      console.warn('[autotel-web] Already initialized. Skipping.');
    }
    return;
  }

  // Validate configuration
  validateConfig(userConfig);

  config = userConfig;

  configureSession(config.session ?? {});

  // Initialize privacy manager if privacy config provided
  if (config.privacy) {
    privacyManager = new PrivacyManager(config.privacy);
  }

  // Seed any baggage known at startup (e.g. tenant from the subdomain).
  if (config.baggage?.initial) {
    setBaggageInternal(config.baggage.initial, config.debug ?? false);
  }

  // Capture unpatched fetch for the exporter before we patch it
  if (config.endpoint !== undefined) {
    setRawFetch(window.fetch.bind(window));
    configureExporter(config.service, config.endpoint, config.debug, {
      ...(config.sampleRate != null && { sampleRate: config.sampleRate }),
    });
    // Browser events are log records, so they need the exporter's log half.
    setEventSink(recordEvent);
  }

  // Patch fetch
  if (config.instrumentFetch !== false) {
    patchFetch();
  }

  // Patch XHR
  if (config.instrumentXHR !== false) {
    patchXMLHttpRequest();
  }

  if (config.endpoint !== undefined) {
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      // The page may not come back. `sendBeacon` is the only send that outlives
      // it, at the cost of reporting no outcome — which is why it is used here
      // and nowhere else.
      endSessionOnUnload();
      flushSpans({ beacon: true });
    });
  }

  isInitialized = true;

  if (config.debug) {
    console.log('[autotel-web] Initialized successfully', {
      service: config.service,
      instrumentFetch: config.instrumentFetch !== false,
      instrumentXHR: config.instrumentXHR !== false,
      privacyEnabled: !!config.privacy,
      privacyConfig: config.privacy
        ? {
            allowedOrigins: config.privacy.allowedOrigins?.length ?? 0,
            blockedOrigins: config.privacy.blockedOrigins?.length ?? 0,
            respectDoNotTrack: config.privacy.respectDoNotTrack ?? false,
            respectGPC: config.privacy.respectGPC ?? false,
          }
        : null,
    });
  }
}

/**
 * Set business-context baggage that propagates end-to-end.
 *
 * Merges `record` into the active baggage (additive, like Sentry `setTags` /
 * Datadog `setGlobalContextProperty`). Every subsequent instrumented request
 * carries it as a W3C `baggage` header (same-origin / allowlisted only), and
 * every browser-recorded span is tagged with it. Invalid entries are dropped
 * (warned in `debug` mode); this never throws in the request path.
 *
 * Safe to call any time after {@link init} — typically right after login or a
 * tenant switch. Requests fired before the call won't carry the new value.
 *
 * @example
 * ```typescript
 * setBaggage({ 'tenant.id': 'acme' });
 * ```
 */
export function setBaggage(record: Record<string, string>): void {
  setBaggageInternal(record, config?.debug ?? false);
}

/**
 * Remove a single baggage key, or clear all baggage when called with no key.
 *
 * @example
 * ```typescript
 * clearBaggage('tenant.id'); // remove one key
 * clearBaggage();            // clear everything (e.g. on logout)
 * ```
 */
export { clearBaggage };

/**
 * Patch fetch() to auto-inject traceparent headers
 */
function patchFetch(): void {
  // Always get the current window.fetch as the original
  // This allows tests to set up mocks before calling init()
  originalFetch = window.fetch.bind(window);

  window.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Get URL string for logging and privacy checks
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Create headers object.
    //
    // `init.headers` replaces a Request's own headers, per the fetch spec, so
    // fall back to the Request's when the caller passed none. Building from
    // `init?.headers` alone dropped every header on `fetch(new Request(url,
    // { headers }))`, authorization included.
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );

    // Only inject if traceparent doesn't already exist
    let injectedTraceparent: string | undefined;
    if (!headers.has('traceparent')) {
      // Check privacy controls
      if (privacyManager && !privacyManager.shouldInjectTraceparent(url)) {
        if (config?.debug) {
          const reason = getDenialReason(privacyManager, url);
          console.log(
            '[autotel-web] Skipped traceparent on fetch (privacy):',
            url,
            reason,
          );
        }
      } else {
        injectedTraceparent = createTraceparent();
        headers.set('traceparent', injectedTraceparent);

        if (config?.debug) {
          console.log(
            '[autotel-web] Injected traceparent on fetch:',
            url,
            injectedTraceparent,
          );
        }
      }
    }

    // Inject W3C baggage header (business context, e.g. tenant.id).
    // Fail-closed by origin and a strict subset of where traceparent goes:
    // only sent if privacy allows AND the destination is same-origin/allowlisted.
    if (hasBaggage() && !headers.has('baggage')) {
      const privacyAllows =
        !privacyManager || privacyManager.shouldInjectTraceparent(url);
      if (
        privacyAllows &&
        isBaggageDestinationAllowed(
          url,
          window.location.origin,
          config?.baggage?.allowedOrigins,
        )
      ) {
        const baggageHeader = getBaggageHeader();
        if (baggageHeader) {
          headers.set('baggage', baggageHeader);
          if (config?.debug) {
            console.log(
              '[autotel-web] Injected baggage on fetch:',
              url,
              baggageHeader,
            );
          }
        }
      }
    }

    // Resolve HTTP method: prefer init override, then Request.method, then default GET
    const method =
      init?.method ??
      (input instanceof Request ? input.method : undefined) ??
      'GET';

    // Call original fetch with updated headers
    const startTime = performance.timeOrigin + performance.now();
    const fetchPromise = originalFetch!(input, { ...init, headers });

    // Export browser span if exporter is configured
    if (injectedTraceparent && isConfigured()) {
      fetchPromise.then(
        (response) => {
          const endTime = performance.timeOrigin + performance.now();
          const parsed = parseTraceparent(injectedTraceparent!);
          if (parsed) {
            let pathname: string;
            try {
              pathname = new URL(url, window.location.origin).pathname;
            } catch {
              pathname = url;
            }
            recordSpan(
              parsed.traceId,
              parsed.spanId,
              `browser ${pathname}`,
              startTime,
              endTime,
              {
                // Tag local spans with current baggage regardless of destination —
                // this is our own telemetry and never leaves our collector.
                ...getBaggageEntries(),
                'http.request.method': method,
                'url.full': url,
                'http.response.status_code': response.status,
              },
            );
          }
        },
        () => {
          const endTime = performance.timeOrigin + performance.now();
          const parsed = parseTraceparent(injectedTraceparent!);
          if (parsed) {
            let pathname: string;
            try {
              pathname = new URL(url, window.location.origin).pathname;
            } catch {
              pathname = url;
            }
            recordSpan(
              parsed.traceId,
              parsed.spanId,
              `browser ${pathname}`,
              startTime,
              endTime,
              {
                ...getBaggageEntries(),
                'http.request.method': method,
                'url.full': url,
              },
            );
          }
        },
      );
    }

    return fetchPromise;
  };
}

/**
 * Patch XMLHttpRequest to auto-inject traceparent headers
 */
function patchXMLHttpRequest(): void {
  // Always get the current prototypes as the originals
  // This allows tests to set up mocks before calling init()
  originalXHROpen = XMLHttpRequest.prototype.open;
  originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  originalXHRSend = XMLHttpRequest.prototype.send;

  // Track which XHR instances have traceparent / baggage set
  const xhrHasTraceparent = new WeakSet<XMLHttpRequest>();
  const xhrHasBaggage = new WeakSet<XMLHttpRequest>();
  // The URL each instance was opened with, for the privacy and origin checks.
  const xhrUrl = new WeakMap<XMLHttpRequest, string>();

  // Patch setRequestHeader to track manual traceparent headers
  XMLHttpRequest.prototype.setRequestHeader = function (
    name: string,
    value: string,
  ): void {
    if (name.toLowerCase() === 'traceparent') {
      xhrHasTraceparent.add(this);
    }
    if (name.toLowerCase() === 'baggage') {
      xhrHasBaggage.add(this);
    }
    // originalXHRSetRequestHeader is always defined here because patchXMLHttpRequest() sets it before patching
    return originalXHRSetRequestHeader!.call(this, name, value);
  };

  // Patch open only to remember the URL and reset per-request state.
  // Injection happens in send().
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ): void {
    // Reset before calling through, not after.
    //
    // open() empties the request headers, so the markers saying this instance
    // already carries one have to go with them, or a reused instance sends
    // every request after the first bare. They have to go *first* because
    // open() fires the OPENED readystatechange before it returns: an app
    // handler that calls setRequestHeader('traceparent') there marks the
    // instance during this call, and clearing afterwards would throw that away
    // and let send() append a second value, producing a comma-joined header no
    // backend can parse.
    xhrHasTraceparent.delete(this);
    xhrHasBaggage.delete(this);
    xhrUrl.set(this, typeof url === 'string' ? url : url.toString());

    // originalXHROpen is always defined here because patchXMLHttpRequest() sets it before patching
    return originalXHROpen!.call(this, method, url, async, username, password);
  };

  /**
   * Inject on send(), not on a readystatechange handler.
   *
   * `open()` fires the OPENED readystatechange before it returns, so a handler
   * assigned afterwards never sees that state and never injected anything. An
   * app assigning its own `xhr.onreadystatechange` would also have replaced
   * ours. send() has neither problem: the request is still OPENED so headers
   * are writable, every manual setRequestHeader call has already been seen, and
   * nothing of the caller's is overwritten.
   */
  XMLHttpRequest.prototype.send = function (
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const urlStr = xhrUrl.get(this) ?? '';

    if (!xhrHasTraceparent.has(this)) {
      if (privacyManager && !privacyManager.shouldInjectTraceparent(urlStr)) {
        if (config?.debug) {
          const reason = getDenialReason(privacyManager, urlStr);
          console.log(
            '[autotel-web] Skipped traceparent on XHR (privacy):',
            urlStr,
            reason,
          );
        }
      } else {
        try {
          const traceparent = createTraceparent();
          // originalXHRSetRequestHeader is always defined here because patchXMLHttpRequest() sets it before patching
          originalXHRSetRequestHeader!.call(this, 'traceparent', traceparent);
          xhrHasTraceparent.add(this);

          if (config?.debug) {
            console.log(
              '[autotel-web] Injected traceparent on XHR:',
              urlStr,
              traceparent,
            );
          }
        } catch (error) {
          // Silently ignore if setRequestHeader fails
          if (config?.debug) {
            console.warn(
              '[autotel-web] Failed to inject traceparent on XHR:',
              error,
            );
          }
        }
      }
    }

    // Inject W3C baggage header (independent of traceparent).
    // Fail-closed by origin and a strict subset of where traceparent goes.
    if (hasBaggage() && !xhrHasBaggage.has(this)) {
      const privacyAllows =
        !privacyManager || privacyManager.shouldInjectTraceparent(urlStr);
      if (
        privacyAllows &&
        isBaggageDestinationAllowed(
          urlStr,
          window.location.origin,
          config?.baggage?.allowedOrigins,
        )
      ) {
        const baggageHeader = getBaggageHeader();
        if (baggageHeader) {
          try {
            originalXHRSetRequestHeader!.call(this, 'baggage', baggageHeader);
            xhrHasBaggage.add(this);
            if (config?.debug) {
              console.log(
                '[autotel-web] Injected baggage on XHR:',
                urlStr,
                baggageHeader,
              );
            }
          } catch (error) {
            if (config?.debug) {
              console.warn(
                '[autotel-web] Failed to inject baggage on XHR:',
                error,
              );
            }
          }
        }
      }
    }

    // originalXHRSend is always defined here because patchXMLHttpRequest() sets it before patching
    return originalXHRSend!.call(this, body);
  };
}

/**
 * Validate configuration at initialization time
 * Catches common misconfigurations early
 */
function validateConfig(userConfig: AutotelWebConfig): void {
  // Validate service name
  if (!userConfig.service || typeof userConfig.service !== 'string') {
    throw new Error(
      '[autotel-web] service name is required and must be a string',
    );
  }

  if (userConfig.service.length === 0) {
    throw new Error('[autotel-web] service name cannot be empty');
  }

  if (userConfig.service.length > 255) {
    console.warn(
      '[autotel-web] service name is very long (> 255 chars). Consider using a shorter name.',
    );
  }

  // Validate privacy config if provided
  if (userConfig.privacy) {
    const { allowedOrigins, blockedOrigins } = userConfig.privacy;

    // Warn if both allowlist and blocklist are empty
    if (
      (!allowedOrigins || allowedOrigins.length === 0) &&
      (!blockedOrigins || blockedOrigins.length === 0) &&
      !userConfig.privacy.respectDoNotTrack &&
      !userConfig.privacy.respectGPC
    ) {
      console.warn(
        '[autotel-web] privacy config provided but all options are empty/disabled. This has no effect.',
      );
    }

    // Warn about overlapping origins
    if (allowedOrigins && blockedOrigins) {
      const overlap = allowedOrigins.filter((allowed) =>
        blockedOrigins.some((blocked) =>
          allowed.toLowerCase().includes(blocked.toLowerCase()),
        ),
      );
      if (overlap.length > 0) {
        console.warn(
          '[autotel-web] Some allowedOrigins match blockedOrigins. Blocklist takes precedence:',
          overlap,
        );
      }
    }

    // Validate origin format (warn if looks invalid)
    const allOrigins = [...(allowedOrigins ?? []), ...(blockedOrigins ?? [])];
    allOrigins.forEach((origin) => {
      if (origin.includes('://')) {
        console.warn(
          `[autotel-web] Origin "${origin}" includes protocol (://) - this is usually not needed. Just use the domain name.`,
        );
      }
    });
  }
}

/**
 * Reset initialization state (for testing)
 * @internal
 */
export function resetForTesting(): void {
  isInitialized = false;
  config = undefined;
  privacyManager = undefined;
  resetExporter();
  resetBaggageForTesting();

  // Restore original fetch/XHR if they were patched
  // Then clear the stored originals so next test can set up fresh mocks
  if (globalThis.window !== undefined) {
    if (originalFetch) {
      window.fetch = originalFetch;
      originalFetch = undefined;
    }
    if (originalXHROpen) {
      XMLHttpRequest.prototype.open = originalXHROpen;
      originalXHROpen = undefined;
    }
    if (originalXHRSetRequestHeader) {
      XMLHttpRequest.prototype.setRequestHeader = originalXHRSetRequestHeader;
      originalXHRSetRequestHeader = undefined;
    }
    if (originalXHRSend) {
      XMLHttpRequest.prototype.send = originalXHRSend;
      originalXHRSend = undefined;
    }
  }
}

/**
 * Get current configuration
 * @internal
 */
export function getConfig(): AutotelWebConfig | undefined {
  return config;
}

/**
 * Get current privacy manager
 * @internal
 */
export function getPrivacyManager(): PrivacyManager | undefined {
  return privacyManager;
}
