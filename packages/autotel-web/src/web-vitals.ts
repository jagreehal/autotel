/**
 * Core Web Vitals (LCP, INP, CLS, FCP, TTFB).
 *
 * OpenTelemetry names this signal `browser.web_vital`, one event per metric, so
 * that is what lands. The previous shape — every metric as an attribute on a
 * single shared span held open until `pagehide` — could not be aggregated
 * (a percentile over LCP means grouping by metric, not by span) and lost
 * everything if the span never closed.
 */

import type { Metric } from 'web-vitals';
import { emitEvent } from './emit-event';
import { AUTOTEL_WEB, WEB_EVENT } from './semconv';

export interface WebVitalsConfig {
  /** Pass reportAllChanges to web-vitals (default: false for stability). */
  reportAllChanges?: boolean;
  debug: boolean;
}

/** The reported shape of a web vital — narrower than `Metric` so tests can call it. */
export interface WebVitalReport {
  name: string;
  value: number;
  rating: string;
  /** Change since this metric was last reported. */
  delta?: number;
  /** Identifier shared by repeated reports of one measurement. */
  id?: string;
}

/**
 * Emit one `browser.web_vital` event. Exported for tests and manual reporting.
 *
 * The name is lower-cased: the convention names these metrics `lcp`, `cls`,
 * `inp`, and the `web-vitals` library reports them upper-cased. Forwarding its
 * casing unchanged would make every query provider-specific.
 */
export function reportWebVital(metric: WebVitalReport, debug: boolean): void {
  const attributes: Record<string, string | number> = {
    [AUTOTEL_WEB.WEB_VITAL_NAME]: metric.name.toLowerCase(),
    [AUTOTEL_WEB.WEB_VITAL_VALUE]: metric.value,
    [AUTOTEL_WEB.WEB_VITAL_RATING]: metric.rating,
  };
  // Absent when a caller reports a metric by hand; always present from the
  // `web-vitals` library, and both are needed to deduplicate repeat reports.
  if (metric.delta !== undefined) {
    attributes[AUTOTEL_WEB.WEB_VITAL_DELTA] = metric.delta;
  }
  if (metric.id !== undefined) attributes[AUTOTEL_WEB.WEB_VITAL_ID] = metric.id;

  emitEvent(WEB_EVENT.WEB_VITAL, attributes);
  if (debug) {
    console.debug(
      `[autotel-web] browser.web_vital ${metric.name}:`,
      metric.value,
      metric.rating,
    );
  }
}

export function setupWebVitals(config: WebVitalsConfig): void {
  if (globalThis.window === undefined) return;

  const opts = { reportAllChanges: config.reportAllChanges ?? false };

  import('web-vitals')
    .then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
      const report = (metric: Metric) =>
        reportWebVital(metric, config.debug ?? false);
      onCLS(report, opts);
      onINP(report, opts);
      onLCP(report, opts);
      onFCP(report, opts);
      onTTFB(report, opts);
    })
    .catch((error) => {
      if (config.debug) {
        console.warn('[autotel-web] web-vitals failed to load:', error);
      }
    });
}
