/**
 * Web Vitals (LCP, INP, CLS, FCP, TTFB) capture for full mode
 *
 * Uses the web-vitals library; reports metrics as attributes on a single
 * "web_vitals" span per page. Span is ended on pagehide or after a timeout.
 */

import { trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import type { Metric } from 'web-vitals';

const SPAN_NAME = 'web_vitals';
const END_DELAY_MS = 60_000; // End span after 60s if pagehide didn't fire

export interface WebVitalsConfig {
  /** Pass reportAllChanges to web-vitals (default: false for stability). */
  reportAllChanges?: boolean;
  debug: boolean;
}

let webVitalsSpan: Span | null = null;
let endTimeoutId: ReturnType<typeof setTimeout> | null = null;

function endSpan(): void {
  if (!webVitalsSpan) return;
  try {
    webVitalsSpan.end();
  } finally {
    webVitalsSpan = null;
    if (endTimeoutId != null) {
      clearTimeout(endTimeoutId);
      endTimeoutId = null;
    }
  }
}

function ensureSpanAndSetMetric(metric: Metric, config: WebVitalsConfig): void {
  const tracer = trace.getTracer('autotel-web', '1.0.0');
  if (!webVitalsSpan) {
    webVitalsSpan = tracer.startSpan(SPAN_NAME);
    window.addEventListener('pagehide', endSpan, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') endSpan();
    });
    endTimeoutId = setTimeout(endSpan, END_DELAY_MS);
  }
  const name = metric.name;
  const key = `web_vitals.${name.toLowerCase()}`;
  webVitalsSpan.setAttribute(key, metric.value);
  webVitalsSpan.setAttribute(`${key}.rating`, metric.rating);
  if (config.debug) {
    console.debug(`[autotel-web] Web Vital ${name}:`, metric.value, metric.rating);
  }
}

export function setupWebVitals(config: WebVitalsConfig): void {
  if (typeof window === 'undefined') return;

  const opts = { reportAllChanges: config.reportAllChanges ?? false };

  import('web-vitals').then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
    const report = (metric: Metric) => ensureSpanAndSetMetric(metric, config);
    onCLS(report, opts);
    onINP(report, opts);
    onLCP(report, opts);
    onFCP(report, opts);
    onTTFB(report, opts);
  }).catch((err) => {
    if (config.debug) {
      console.warn('[autotel-web] web-vitals failed to load:', err);
    }
  });
}
