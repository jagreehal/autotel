/**
 * http.client.network_timing event from Performance Resource Timing API
 *
 * Maps browser PerformanceResourceTiming to the proposed semantic convention
 * (semantic-conventions#3385). Emits one event per fetch/xhr resource.
 * Timestamps: http.call.start_time and http.call.end_time required (ms since epoch);
 * other attributes as deltas from http.call.start_time when available.
 * Omit attributes when value is 0 or unavailable (browser uses 0 for "phase did not happen").
 */

import { trace } from '@opentelemetry/api';

const EVENT_NAME = 'http.client.network_timing';

export interface NetworkTimingObserverConfig {
  /** Copy original HTTP span attributes onto the event for backends that need them. */
  copyHttpSpanAttributes: boolean;
  debug: boolean;
}

/** Map PerformanceResourceTiming to event attributes. timeOrigin is performance.timeOrigin. */
function timingToAttributes(
  entry: PerformanceResourceTiming,
  timeOrigin: number,
) {
  const optional: Array<[string, number]> = [];

  const fetchStart = entry.fetchStart;
  const responseEnd = entry.responseEnd;
  // Required: absolute ms since epoch
  const callStartMs = timeOrigin + fetchStart;
  const callEndMs = timeOrigin + responseEnd;

  // Only add attribute when phase happened (browser uses 0 for "did not happen"); use epoch ms
  // A browser reports 0 for a phase that did not happen, which is not a time.
  const addIfPositive = (key: string, rawValue: number) => {
    if (rawValue > 0) optional.push([key, Math.round(timeOrigin + rawValue)]);
  };
  addIfPositive('http.redirect.start_time', entry.redirectStart);
  addIfPositive('http.redirect.end_time', entry.redirectEnd);
  addIfPositive('http.dns.start_time', entry.domainLookupStart);
  addIfPositive('http.dns.end_time', entry.domainLookupEnd);
  addIfPositive('http.connect.start_time', entry.connectStart);
  addIfPositive('http.connect.end_time', entry.connectEnd);
  addIfPositive('http.secure_connect.start_time', entry.secureConnectionStart);
  addIfPositive('http.request.headers.start_time', entry.requestStart);
  addIfPositive('http.response.headers.start_time', entry.responseStart);
  addIfPositive('http.worker.start_time', entry.workerStart);

  return {
    'http.call.start_time': Math.round(callStartMs),
    'http.call.end_time': Math.round(callEndMs),
    ...Object.fromEntries(optional),
  };
}

/** Optional: add resource size/status from Resource Timing when useful */
function addResourceAttributes(
  entry: PerformanceResourceTiming,
  attrs: Record<string, number | string>,
): void {
  if (entry.transferSize > 0) {
    attrs['http.response.size'] = entry.transferSize;
  }
  if (entry.encodedBodySize > 0) {
    attrs['http.response.body.size'] = entry.encodedBodySize;
  }
  // SAFETY: responseStatus is in the Resource Timing spec but missing from the
  // DOM lib; the `!= null` guard below covers a browser that does not send it.
  const status = (
    entry as PerformanceResourceTiming & { responseStatus?: number }
  ).responseStatus;
  if (status != null && status > 0) {
    attrs['http.response.status_code'] = status;
  }
}

export function setupNetworkTimingObserver(
  config: NetworkTimingObserverConfig,
): void {
  if (globalThis.window === undefined || !window.PerformanceObserver) {
    return;
  }
  const timeOrigin = performance.timeOrigin;

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        if (entry.entryType !== 'resource') continue;
        // SAFETY: the guard above skipped every entry whose entryType is not
        // 'resource', which is what makes this a PerformanceResourceTiming.
        const resource = entry as PerformanceResourceTiming;
        const initiator = resource.initiatorType ?? '';
        if (initiator !== 'fetch' && initiator !== 'xmlhttprequest') continue;
        if (resource.duration <= 0) continue;

        const attrs: Record<string, number | string> = timingToAttributes(
          resource,
          timeOrigin,
        );
        addResourceAttributes(resource, attrs);

        // Emit as span event: attach to active span when available (same trace as HTTP span)
        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
          activeSpan.addEvent(EVENT_NAME, attrs);
        } else if (config.debug) {
          console.debug(
            '[autotel-web] network_timing: no active span for',
            resource.name,
          );
        }
      }
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch (e) {
    if (config.debug) {
      console.warn('[autotel-web] Network timing observer failed:', e);
    }
  }
}
