/**
 * Minimal browser SDK initialization
 *
 * Patches fetch() and XMLHttpRequest to automatically inject W3C traceparent headers.
 * NO OpenTelemetry dependencies - just native browser APIs.
 *
 * Bundle size: ~2-5KB gzipped
 */

import { createTraceparent } from './traceparent';
import { PrivacyManager, PrivacyConfig, getDenialReason } from './privacy';

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

  // Patch fetch
  if (config.instrumentFetch !== false) {
    patchFetch();
  }

  // Patch XHR
  if (config.instrumentXHR !== false) {
    patchXMLHttpRequest();
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
        // Inject traceparent header
        headers.set('traceparent', createTraceparent());

        if (config?.debug) {
          console.log(
            '[autotel-web] Injected traceparent on fetch:',
            url,
            headers.get('traceparent')
          );
        }
      }
    }

    // Call original fetch with updated headers
    // originalFetch is always defined here because patchFetch() sets it before patching
    return originalFetch!(input, { ...init, headers });
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

  // Track which XHR instances have traceparent set
  const xhrHasTraceparent = new WeakSet<XMLHttpRequest>();

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
