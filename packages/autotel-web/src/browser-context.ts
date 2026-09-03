/**
 * Which browser this is.
 *
 * `browser.*` is a canonical OpenTelemetry resource convention, and without it
 * a span cannot answer "does this only break on mobile Safari?" — the single
 * most common first question about a front-end bug.
 *
 * Only what the platform states outright is recorded. `user_agent.name` and
 * friends need a real user-agent database to derive, and every OTLP collector
 * ships one; guessing them here would ship a stale regex to every visitor and
 * be wrong in a way nobody could correct without a release.
 */

import { BROWSER, USER_AGENT } from './semconv';

interface UserAgentBrand {
  brand: string;
  version: string;
}

interface UserAgentData {
  platform?: string;
  mobile?: boolean;
  brands?: UserAgentBrand[];
}

export type BrowserResourceAttributes = Record<
  string,
  string | boolean | string[]
>;

/**
 * Canonical `browser.*` attributes for this page, ready to spread into a
 * resource. Empty off-browser, so callers can spread unconditionally.
 */
export function browserResourceAttributes(): BrowserResourceAttributes {
  if (globalThis.navigator === undefined) return {};

  const attributes: BrowserResourceAttributes = {};
  const { language } = navigator;
  if (language) attributes[BROWSER.LANGUAGE] = language;

  // Stated by the platform, not inferred: Playwright, Puppeteer, Selenium and
  // every browser agent built on them set it. Without the flag their sessions
  // land in the same dashboards as people's, and a headless run's vitals and
  // dead clicks are not a human's.
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver === true) {
    attributes[USER_AGENT.SYNTHETIC_TYPE] = 'test';
  }

  // Chromium-only; absent in Safari and Firefox, where it stays absent rather
  // than being inferred.
  const data = (navigator as Navigator & { userAgentData?: UserAgentData })
    .userAgentData;
  if (data) {
    if (typeof data.platform === 'string') {
      attributes[BROWSER.PLATFORM] = data.platform;
    }
    if (typeof data.mobile === 'boolean') {
      attributes[BROWSER.MOBILE] = data.mobile;
    }
    if (Array.isArray(data.brands) && data.brands.length > 0) {
      attributes[BROWSER.BRANDS] = data.brands.map(
        (brand) => `${brand.brand} ${brand.version}`,
      );
    }
  }
  return attributes;
}
