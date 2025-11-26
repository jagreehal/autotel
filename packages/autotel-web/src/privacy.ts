/**
 * Privacy controls for autotel-web
 *
 * Provides origin filtering and privacy signal respecting (DNT, GPC)
 * to ensure compliance with GDPR, CCPA, and user privacy preferences.
 */

export interface PrivacyConfig {
  /**
   * Only inject traceparent headers on requests to these origins (whitelist)
   *
   * If specified, traceparent will ONLY be injected on matching origins.
   * Origins are matched using substring matching (e.g., "example.com" matches "https://api.example.com").
   *
   * @example
   * ```typescript
   * {
   *   allowedOrigins: ['api.myapp.com', 'myapp.com']
   * }
   * ```
   */
  allowedOrigins?: string[];

  /**
   * Never inject traceparent headers on requests to these origins (blacklist)
   *
   * Takes precedence over allowedOrigins.
   * Origins are matched using substring matching.
   *
   * @example
   * ```typescript
   * {
   *   blockedOrigins: ['analytics.google.com', 'facebook.com']
   * }
   * ```
   */
  blockedOrigins?: string[];

  /**
   * Respect the Do Not Track (DNT) browser setting
   *
   * If true and user has DNT enabled, no traceparent headers will be injected.
   *
   * @default false
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/doNotTrack
   */
  respectDoNotTrack?: boolean;

  /**
   * Respect the Global Privacy Control (GPC) browser signal
   *
   * If true and user has GPC enabled, no traceparent headers will be injected.
   *
   * @default false
   * @see https://globalprivacycontrol.org/
   */
  respectGPC?: boolean;
}

/**
 * Manages privacy controls for traceparent header injection
 *
 * Checks user privacy preferences (DNT, GPC) and origin filtering rules
 * to determine if traceparent headers should be injected on a given request.
 */
export class PrivacyManager {
  constructor(private readonly config: PrivacyConfig) {}

  /**
   * Check if traceparent header should be injected for a given URL
   *
   * Decision order:
   * 1. Check Do Not Track (if enabled)
   * 2. Check Global Privacy Control (if enabled)
   * 3. Check blockedOrigins (explicit deny)
   * 4. Check allowedOrigins (explicit allow, if configured)
   * 5. Default: allow
   *
   * @param url - Full URL or relative path of the request
   * @returns true if traceparent should be injected, false otherwise
   */
  shouldInjectTraceparent(url: string): boolean {
    // Check Do Not Track
    if (this.config.respectDoNotTrack && this.isDoNotTrackEnabled()) {
      return false;
    }

    // Check Global Privacy Control
    if (this.config.respectGPC && this.isGPCEnabled()) {
      return false;
    }

    // Get the origin of the target URL
    const targetOrigin = this.extractOrigin(url);

    // Check blocklist first (explicit deny takes precedence)
    if (
      this.config.blockedOrigins &&
      this.matchesAnyOrigin(targetOrigin, this.config.blockedOrigins)
    ) {
      return false;
    }

    // If allowlist exists, only allow those origins
    if (this.config.allowedOrigins && this.config.allowedOrigins.length > 0) {
      return this.matchesAnyOrigin(targetOrigin, this.config.allowedOrigins);
    }

    // Default: allow (backward compatible behavior)
    return true;
  }

  /**
   * Check if Do Not Track is enabled in the browser
   */
  private isDoNotTrackEnabled(): boolean {
    if (typeof navigator === 'undefined') return false;

    // DNT header can be "1" (enabled), "0" (disabled), or null (not set)
    return navigator.doNotTrack === '1';
  }

  /**
   * Check if Global Privacy Control is enabled in the browser
   */
  private isGPCEnabled(): boolean {
    if (typeof navigator === 'undefined') return false;

    // GPC is a newer spec, not all browsers support it yet
    // TypeScript doesn't have types for this yet, so we cast
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    return nav.globalPrivacyControl === true;
  }

  /**
   * Extract origin from a URL (handles both absolute and relative URLs)
   *
   * @param url - Full URL or relative path
   * @returns Origin string (e.g., "https://api.example.com")
   */
  private extractOrigin(url: string): string {
    try {
      // Handle absolute URLs
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return new URL(url).origin;
      }

      // Handle relative URLs - use current window location
      if (typeof window !== 'undefined') {
        return new URL(url, window.location.href).origin;
      }

      // Fallback for SSR or unknown cases
      return '';
    } catch {
      // Invalid URL - return empty string
      return '';
    }
  }

  /**
   * Check if a target origin matches any of the configured origins
   *
   * Uses substring matching for flexibility (e.g., "example.com" matches "https://api.example.com")
   *
   * @param targetOrigin - Origin to check
   * @param configuredOrigins - List of allowed or blocked origins
   * @returns true if any origin matches
   */
  private matchesAnyOrigin(
    targetOrigin: string,
    configuredOrigins: string[]
  ): boolean {
    return configuredOrigins.some((configuredOrigin) => {
      // Normalize both strings to lowercase for case-insensitive matching
      const normalizedTarget = targetOrigin.toLowerCase();
      const normalizedConfigured = configuredOrigin.toLowerCase();

      // Check if target origin contains the configured origin
      // This allows "example.com" to match "https://api.example.com"
      return normalizedTarget.includes(normalizedConfigured);
    });
  }
}

/**
 * Get reason why traceparent injection was denied (for debugging)
 *
 * Returns a human-readable reason if injection would be blocked,
 * or null if injection would be allowed.
 *
 * @param privacyManager - Configured PrivacyManager instance
 * @param url - URL to check
 * @returns Denial reason or null if allowed
 *
 * @example
 * ```typescript
 * const manager = new PrivacyManager({ respectDoNotTrack: true })
 * const reason = getDenialReason(manager, 'https://api.example.com')
 * if (reason) {
 *   console.log('Traceparent blocked:', reason)
 * }
 * ```
 */
export function getDenialReason(
  privacyManager: PrivacyManager,
  url: string
): string | null {
  // This is a helper for debugging - it re-checks the conditions
  // to provide a user-friendly reason string
  const config = (privacyManager as any).config as PrivacyConfig;

  // Check DNT
  if (config.respectDoNotTrack && typeof navigator !== 'undefined') {
    if (navigator.doNotTrack === '1') {
      return 'Do Not Track is enabled';
    }
  }

  // Check GPC
  if (config.respectGPC && typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.globalPrivacyControl === true) {
      return 'Global Privacy Control is enabled';
    }
  }

  // Extract origin
  let targetOrigin = '';
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      targetOrigin = new URL(url).origin;
    } else if (typeof window !== 'undefined') {
      targetOrigin = new URL(url, window.location.href).origin;
    }
  } catch {
    return 'Invalid URL';
  }

  // Check blocklist
  if (config.blockedOrigins) {
    const blocked = config.blockedOrigins.some((origin) =>
      targetOrigin.toLowerCase().includes(origin.toLowerCase())
    );
    if (blocked) {
      return `Origin ${targetOrigin} is in blockedOrigins list`;
    }
  }

  // Check allowlist
  if (config.allowedOrigins && config.allowedOrigins.length > 0) {
    const allowed = config.allowedOrigins.some((origin) =>
      targetOrigin.toLowerCase().includes(origin.toLowerCase())
    );
    if (!allowed) {
      return `Origin ${targetOrigin} is not in allowedOrigins list`;
    }
  }

  return null;
}
