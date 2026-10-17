/**
 * Core Web Vitals (LCP, INP, CLS, FCP, TTFB).
 *
 * OpenTelemetry names this signal `browser.web_vital`, one event per metric, so
 * that is what lands. The previous shape — every metric as an attribute on a
 * single shared span held open until `pagehide` — could not be aggregated
 * (a percentile over LCP means grouping by metric, not by span) and lost
 * everything if the span never closed.
 */

import type { MetricWithAttribution } from 'web-vitals/attribution';
import { emitEvent } from './emit-event';
import { AUTOTEL_WEB, WEB_EVENT } from './semconv';

export interface WebVitalsConfig {
  /** Pass reportAllChanges to web-vitals (default: false for stability). */
  reportAllChanges?: boolean;
  /**
   * Report vitals per soft navigation (SPA route change) as well as per page
   * load, where the browser supports the Soft Navigations API. Each report then
   * carries that route's `navigation_id` and `navigation_url` (default: false).
   */
  reportSoftNavs?: boolean;
  debug: boolean;
  /** The configured `attributeRedactor`, applied to selectors and URLs. */
  redactor?: (value: string) => string;
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
  navigationType?: string;
  navigationId?: number;
  navigationURL?: string;
  navigationInteractionId?: number;
  /** `web-vitals/attribution` breakdown: which element, which phase. */
  attribution?: object;
}

/**
 * Attribution keys copied as-is when numeric. The three elements a vital can
 * blame (LCP element, largest shift, INP target) share one attribute, so
 * "group by target where name = lcp" is one query rather than three.
 */
const ATTRIBUTION_NUMBERS: Record<string, string> = {
  timeToFirstByte: AUTOTEL_WEB.WEB_VITAL_TIME_TO_FIRST_BYTE,
  resourceLoadDelay: AUTOTEL_WEB.WEB_VITAL_RESOURCE_LOAD_DELAY,
  resourceLoadDuration: AUTOTEL_WEB.WEB_VITAL_RESOURCE_LOAD_DURATION,
  elementRenderDelay: AUTOTEL_WEB.WEB_VITAL_ELEMENT_RENDER_DELAY,
  inputDelay: AUTOTEL_WEB.WEB_VITAL_INPUT_DELAY,
  processingDuration: AUTOTEL_WEB.WEB_VITAL_PROCESSING_DURATION,
  presentationDelay: AUTOTEL_WEB.WEB_VITAL_PRESENTATION_DELAY,
  firstByteToFCP: AUTOTEL_WEB.WEB_VITAL_FIRST_BYTE_TO_FCP,
  waitingDuration: AUTOTEL_WEB.WEB_VITAL_WAITING_DURATION,
  cacheDuration: AUTOTEL_WEB.WEB_VITAL_CACHE_DURATION,
  dnsDuration: AUTOTEL_WEB.WEB_VITAL_DNS_DURATION,
  connectionDuration: AUTOTEL_WEB.WEB_VITAL_CONNECTION_DURATION,
  requestDuration: AUTOTEL_WEB.WEB_VITAL_REQUEST_DURATION,
  largestShiftValue: AUTOTEL_WEB.WEB_VITAL_LARGEST_SHIFT_VALUE,
  totalScriptDuration: AUTOTEL_WEB.WEB_VITAL_TOTAL_SCRIPT_DURATION,
  totalStyleAndLayoutDuration:
    AUTOTEL_WEB.WEB_VITAL_TOTAL_STYLE_AND_LAYOUT_DURATION,
  totalPaintDuration: AUTOTEL_WEB.WEB_VITAL_TOTAL_PAINT_DURATION,
  totalUnattributedDuration: AUTOTEL_WEB.WEB_VITAL_TOTAL_UNATTRIBUTED_DURATION,
};

/** The fields of `PerformanceScriptTiming` worth a log record. */
interface ScriptTiming {
  sourceURL?: string;
  sourceFunctionName?: string;
  invoker?: string;
  invokerType?: string;
  forcedStyleAndLayoutDuration?: number;
}

interface LongestScript {
  entry?: ScriptTiming;
  subpart?: string;
  intersectingDuration?: number;
}

const ATTRIBUTION_STRINGS: Record<string, string> = {
  target: AUTOTEL_WEB.WEB_VITAL_TARGET,
  largestShiftTarget: AUTOTEL_WEB.WEB_VITAL_TARGET,
  interactionTarget: AUTOTEL_WEB.WEB_VITAL_TARGET,
  interactionType: AUTOTEL_WEB.WEB_VITAL_INTERACTION_TYPE,
  loadState: AUTOTEL_WEB.WEB_VITAL_LOAD_STATE,
};

const MAX_RESOURCE_URL_LENGTH = 1024;

/**
 * Origin and path name the asset; query and fragment can carry signed tokens.
 * Only http(s): a `data:` LCP image is the whole image, base64-encoded, and
 * would turn one log record into megabytes the collector rejects.
 */
function stripUrl(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * Emit one `browser.web_vital` event. Exported for tests and manual reporting.
 *
 * The name is lower-cased: the convention names these metrics `lcp`, `cls`,
 * `inp`, and the `web-vitals` library reports them upper-cased. Forwarding its
 * casing unchanged would make every query provider-specific.
 */
export function reportWebVital(
  metric: WebVitalReport,
  debug: boolean,
  redactor: (value: string) => string = (value) => value,
): void {
  // Redact before capping: a cut through an email or token leaves a fragment
  // the redactor's pattern no longer matches, and exports it.
  const safeUrl = (raw: string) => {
    const url = stripUrl(raw);
    return url && redactor(url).slice(0, MAX_RESOURCE_URL_LENGTH);
  };
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
  if (metric.navigationType) {
    attributes[AUTOTEL_WEB.WEB_VITAL_NAVIGATION_TYPE] = metric.navigationType;
  }
  if (metric.navigationId !== undefined) {
    attributes[AUTOTEL_WEB.WEB_VITAL_NAVIGATION_ID] = metric.navigationId;
  }
  if (metric.navigationInteractionId !== undefined) {
    attributes[AUTOTEL_WEB.WEB_VITAL_NAVIGATION_INTERACTION_ID] =
      metric.navigationInteractionId;
  }
  const navigationUrl = metric.navigationURL && safeUrl(metric.navigationURL);
  if (navigationUrl) {
    attributes[AUTOTEL_WEB.WEB_VITAL_NAVIGATION_URL] = navigationUrl;
  }
  for (const [key, value] of Object.entries(metric.attribution ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const name = ATTRIBUTION_NUMBERS[key];
      if (name) attributes[name] = value;
    } else if (typeof value === 'string' && value) {
      // Selectors carry element ids (`#user-4821`), URL paths carry slugs:
      // both are page content, so both go through the app's redactor.
      const name = ATTRIBUTION_STRINGS[key];
      if (name) attributes[name] = redactor(value);
      else if (key === 'url') {
        const url = safeUrl(value);
        if (url) attributes[AUTOTEL_WEB.WEB_VITAL_RESOURCE_URL] = url;
      }
    }
  }

  // INP's culprit script, summarised by web-vitals from long-animation-frame
  // entries: one record names the script, not one span per frame and script.
  const longest = (metric.attribution as { longestScript?: LongestScript })
    ?.longestScript;
  if (longest) {
    const { entry = {}, subpart, intersectingDuration } = longest;
    const scriptUrl = entry.sourceURL && safeUrl(entry.sourceURL);
    const strings: Array<[string, string | undefined]> = [
      [AUTOTEL_WEB.WEB_VITAL_LONGEST_SCRIPT_URL, scriptUrl],
      [
        AUTOTEL_WEB.WEB_VITAL_LONGEST_SCRIPT_FUNCTION,
        entry.sourceFunctionName && redactor(entry.sourceFunctionName),
      ],
      // `BUTTON#user-4821.onclick`: a selector, so redacted like one.
      [
        AUTOTEL_WEB.WEB_VITAL_LONGEST_SCRIPT_INVOKER,
        entry.invoker && redactor(entry.invoker),
      ],
      [AUTOTEL_WEB.WEB_VITAL_LONGEST_SCRIPT_INVOKER_TYPE, entry.invokerType],
      [AUTOTEL_WEB.WEB_VITAL_LONGEST_SCRIPT_SUBPART, subpart],
    ];
    for (const [name, value] of strings) if (value) attributes[name] = value;
    const numbers: Array<[string, number | undefined]> = [
      [AUTOTEL_WEB.WEB_VITAL_LONGEST_SCRIPT_DURATION, intersectingDuration],
      [
        AUTOTEL_WEB.WEB_VITAL_LONGEST_SCRIPT_FORCED_STYLE_AND_LAYOUT_DURATION,
        entry.forcedStyleAndLayoutDuration,
      ],
    ];
    for (const [name, value] of numbers) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        attributes[name] = value;
      }
    }
  }

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

  const opts = {
    reportAllChanges: config.reportAllChanges ?? false,
    reportSoftNavs: config.reportSoftNavs ?? false,
  };

  // The attribution build names the element and phase behind each value.
  import('web-vitals/attribution')
    .then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
      const report = (metric: MetricWithAttribution) =>
        reportWebVital(metric, config.debug ?? false, config.redactor);
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
