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
import { configureExporter, setRawFetch, recordSpan, flushSpans, isConfigured, resetForTesting as resetExporter } from './span-exporter';
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
}

let isInitialized = false;
let config: AutotelWebConfig | undefined;
let privacyManager: PrivacyManager | undefined;
let originalFetch: typeof window.fetch | undefined;
let originalXHROpen: typeof XMLHttpRequest.prototype.open | undefined;
let originalXHRSetRequestHeader: typeof XMLHttpRequest.prototype.setRequestHeader | undefined;

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
  if (typeof window === 'undefined') {
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
    configureExporter(config.service, config.endpoint, config.debug);
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
      if (document.visibilityState === 'hidden') flushSpans();
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
    init?: RequestInit
  ): Promise<Response> {
    // Get URL string for logging and privacy checks
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Create headers object
    const headers = new Headers(init?.headers);

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
            reason
          );
        }
      } else {
        injectedTraceparent = createTraceparent();
        headers.set('traceparent', injectedTraceparent);

        if (config?.debug) {
          console.log(
            '[autotel-web] Injected traceparent on fetch:',
            url,
            injectedTraceparent
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
            console.log('[autotel-web] Injected baggage on fetch:', url, baggageHeader);
          }
        }
      }
    }

    // Resolve HTTP method: prefer init override, then Request.method, then default GET
    const method = init?.method
      ?? (input instanceof Request ? input.method : undefined)
      ?? 'GET';

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
            try { pathname = new URL(url, window.location.origin).pathname; } catch { pathname = url; }
            recordSpan(parsed.traceId, parsed.spanId, `browser ${pathname}`, startTime, endTime, {
              // Tag local spans with current baggage regardless of destination —
              // this is our own telemetry and never leaves our collector.
              ...getBaggageEntries(),
              'http.method': method,
              'http.url': url,
              'http.status_code': response.status,
            });
          }
        },
        () => {
          const endTime = performance.timeOrigin + performance.now();
          const parsed = parseTraceparent(injectedTraceparent!);
          if (parsed) {
            let pathname: string;
            try { pathname = new URL(url, window.location.origin).pathname; } catch { pathname = url; }
            recordSpan(parsed.traceId, parsed.spanId, `browser ${pathname}`, startTime, endTime, {
              ...getBaggageEntries(),
              'http.method': method,
              'http.url': url,
            });
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

  // Track which XHR instances have traceparent / baggage set
  const xhrHasTraceparent = new WeakSet<XMLHttpRequest>();
  const xhrHasBaggage = new WeakSet<XMLHttpRequest>();

  // Patch setRequestHeader to track manual traceparent headers
  XMLHttpRequest.prototype.setRequestHeader = function (
    name: string,
    value: string
  ): void {
    if (name.toLowerCase() === 'traceparent') {
      xhrHasTraceparent.add(this);
    }
    // originalXHRSetRequestHeader is always defined here because patchXMLHttpRequest() sets it before patching
    return originalXHRSetRequestHeader!.call(this, name, value);
  };

  // Patch open to inject traceparent after headers are ready
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null
  ): void {
    // Call original open
    // originalXHROpen is always defined here because patchXMLHttpRequest() sets it before patching
    const result = originalXHROpen!.call(this, method, url, async, username, password);

    // Convert URL to string for logging and privacy checks
    const urlStr = typeof url === 'string' ? url : url.toString();

    // Listen for readyState change to inject header at the right time
    const xhr = this;
    const originalOnReadyStateChange = xhr.onreadystatechange;

    xhr.onreadystatechange = function (event: Event) {
      // OPENED state (1) - headers can now be set
      if (xhr.readyState === XMLHttpRequest.OPENED) {
        // Only inject if not already set
        if (!xhrHasTraceparent.has(xhr)) {
          // Check privacy controls
          if (privacyManager && !privacyManager.shouldInjectTraceparent(urlStr)) {
            if (config?.debug) {
              const reason = getDenialReason(privacyManager, urlStr);
              console.log(
                '[autotel-web] Skipped traceparent on XHR (privacy):',
                urlStr,
                reason
              );
            }
          } else {
            // Inject traceparent header
            try {
              const traceparent = createTraceparent();
              // originalXHRSetRequestHeader is always defined here because patchXMLHttpRequest() sets it before patching
              originalXHRSetRequestHeader!.call(xhr, 'traceparent', traceparent);

              if (config?.debug) {
                console.log(
                  '[autotel-web] Injected traceparent on XHR:',
                  urlStr,
                  traceparent
                );
              }
            } catch (error) {
              // Silently ignore if setRequestHeader fails
              if (config?.debug) {
                console.warn(
                  '[autotel-web] Failed to inject traceparent on XHR:',
                  error
                );
              }
            }
          }
        }

        // Inject W3C baggage header (independent of traceparent).
        // Fail-closed by origin and a strict subset of where traceparent goes.
        if (hasBaggage() && !xhrHasBaggage.has(xhr)) {
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
                originalXHRSetRequestHeader!.call(xhr, 'baggage', baggageHeader);
                xhrHasBaggage.add(xhr);
                if (config?.debug) {
                  console.log('[autotel-web] Injected baggage on XHR:', urlStr, baggageHeader);
                }
              } catch (error) {
                if (config?.debug) {
                  console.warn('[autotel-web] Failed to inject baggage on XHR:', error);
                }
              }
            }
          }
        }
      }

      // Call original handler if it exists
      if (originalOnReadyStateChange) {
        return originalOnReadyStateChange.call(xhr, event);
      }
    };

    return result;
  };
}

/**
 * Validate configuration at initialization time
 * Catches common misconfigurations early
 */
function validateConfig(userConfig: AutotelWebConfig): void {
  // Validate service name
  if (!userConfig.service || typeof userConfig.service !== 'string') {
    throw new Error('[autotel-web] service name is required and must be a string');
  }

  if (userConfig.service.length === 0) {
    throw new Error('[autotel-web] service name cannot be empty');
  }

  if (userConfig.service.length > 255) {
    console.warn(
      '[autotel-web] service name is very long (> 255 chars). Consider using a shorter name.'
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
        '[autotel-web] privacy config provided but all options are empty/disabled. This has no effect.'
      );
    }

    // Warn about overlapping origins
    if (allowedOrigins && blockedOrigins) {
      const overlap = allowedOrigins.filter((allowed) =>
        blockedOrigins.some((blocked) =>
          allowed.toLowerCase().includes(blocked.toLowerCase())
        )
      );
      if (overlap.length > 0) {
        console.warn(
          '[autotel-web] Some allowedOrigins match blockedOrigins. Blocklist takes precedence:',
          overlap
        );
      }
    }

    // Validate origin format (warn if looks invalid)
    const allOrigins = [
      ...(allowedOrigins ?? []),
      ...(blockedOrigins ?? []),
    ];
    allOrigins.forEach((origin) => {
      if (origin.includes('://')) {
        console.warn(
          `[autotel-web] Origin "${origin}" includes protocol (://) - this is usually not needed. Just use the domain name.`
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
  if (typeof window !== 'undefined') {
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
