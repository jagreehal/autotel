/**
 * Full browser tracing with OpenTelemetry SDK
 *
 * Single install: npm install autotel-web. Import from 'autotel-web/full'.
 * No Zone.js - uses default context manager. Async context propagation is best-effort.
 *
 * @see https://github.com/open-telemetry/semantic-conventions/issues/3385 (http.client.network_timing)
 */

import { trace as otelTrace, context } from '@opentelemetry/api';
import type { Sampler, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';
import {
  BatchSpanProcessor,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { PrivacyConfig } from './privacy';
import { setupNetworkTimingObserver } from './network-timing';
import { setupUserInteractionInstrumentation } from './user-interaction';
import { setupErrorCapture } from './errors';
import { setupWebVitals } from './web-vitals';
import { setupLongTaskObserver } from './long-tasks';

export interface AutotelWebFullConfig {
  /** Service name for the browser application */
  service: string;

  /**
   * OTLP endpoint URL for trace export (e.g. https://api.example.com/v1/traces).
   * If not set, no export (spans still created; use spanProcessor for custom export).
   */
  endpoint?: string;

  /**
   * Custom span processor(s). If provided, used instead of default BatchSpanProcessor + OTLP exporter.
   * When endpoint is set, this is ignored.
   */
  spanProcessor?: SpanProcessor;

  /**
   * Sample rate 0–1. Default 1.0. Use e.g. 0.1 in production.
   */
  sampleRate?: number;

  /** Custom sampler. If set, sampleRate is ignored. */
  sampler?: Sampler;

  /** Enable document load / navigation spans. @default true */
  captureNavigation?: boolean;

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

  /** Optional user interaction (click) spans. */
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
   * Capture Web Vitals (LCP, INP, CLS, FCP, TTFB) and report as attributes on a web_vitals span.
   * @default true
   */
  captureWebVitals?: boolean;

  /**
   * Options for Web Vitals. reportAllChanges: pass through to web-vitals (default false for stability).
   */
  webVitals?: { reportAllChanges?: boolean };

  /**
   * Capture long tasks (main thread blocking >= 50ms) as long_task spans. Opt-in; can be noisy.
   * @default false
   */
  captureLongTasks?: boolean;

  /** Privacy controls (origin filtering, DNT, GPC). Applied to which requests get traced. */
  privacy?: PrivacyConfig;

  /** Enable debug logging. @default false */
  debug?: boolean;
}

let isFullInitialized = false;
let provider: WebTracerProvider | undefined;

/**
 * Initialize full browser tracing (spans + optional export).
 *
 * Call once, client-side only. Uses OpenTelemetry WebTracerProvider; no Zone.js.
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
  if (typeof window === 'undefined') {
    return;
  }
  if (isFullInitialized) {
    if (config.debug) {
      console.warn('[autotel-web/full] Already initialized. Skipping.');
    }
    return;
  }

  const service = config.service ?? 'browser';
  const resource = resourceFromAttributes({ 'service.name': service });

  const spanProcessors: SpanProcessor[] = [];
  if (config.spanProcessor) {
    spanProcessors.push(config.spanProcessor);
  } else if (config.endpoint) {
    const exporter = new OTLPTraceExporter({
      url: config.endpoint,
    });
    spanProcessors.push(
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 1000,
        maxExportBatchSize: 64,
      })
    );
  } else {
    // No export; still create spans (e.g. for propagation only)
    if (config.debug) {
      console.log('[autotel-web/full] No endpoint or spanProcessor; spans will not be exported.');
    }
  }

  const sampler = config.sampler ?? (config.sampleRate != null
    ? createRatioSampler(config.sampleRate)
    : undefined);

  provider = new WebTracerProvider({
    resource,
    spanProcessors,
    ...(sampler && { sampler }),
  });
  provider.register({
    propagator: new W3CTraceContextPropagator(),
    // No contextManager: use default (no Zone.js). Async context is best-effort.
  });

  const instrumentations: Array<
    | DocumentLoadInstrumentation
    | FetchInstrumentation
    | XMLHttpRequestInstrumentation
  > = [];

  if (config.captureNavigation !== false) {
    instrumentations.push(new DocumentLoadInstrumentation());
  }
  if (config.captureFetch !== false) {
    const fetchOptions: ConstructorParameters<typeof FetchInstrumentation>[0] = {};
    if (config.privacy?.allowedOrigins?.length) {
      fetchOptions.propagateTraceHeaderCorsUrls = config.privacy.allowedOrigins.map(
        (o) => new RegExp(escapeRegex(o), 'i')
      );
    }
    instrumentations.push(new FetchInstrumentation(fetchOptions));
  }
  if (config.captureXHR !== false) {
    const xhrOptions: ConstructorParameters<typeof XMLHttpRequestInstrumentation>[0] = {};
    if (config.privacy?.allowedOrigins?.length) {
      xhrOptions.propagateTraceHeaderCorsUrls = config.privacy.allowedOrigins;
    }
    instrumentations.push(new XMLHttpRequestInstrumentation(xhrOptions));
  }

  registerInstrumentations({
    instrumentations,
  });

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

  if (config.captureErrors !== false) {
    setupErrorCapture({ debug: config.debug ?? false });
  }

  if (config.captureWebVitals !== false) {
    setupWebVitals({
      reportAllChanges: config.webVitals?.reportAllChanges ?? false,
      debug: config.debug ?? false,
    });
  }

  if (config.captureLongTasks === true) {
    setupLongTaskObserver({ debug: config.debug ?? false });
  }

  isFullInitialized = true;
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
    });
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createRatioSampler(ratio: number): Sampler {
  return {
    shouldSample(_context, _traceId, _spanName, _spanKind, _attributes, _links) {
      if (ratio >= 1) return { decision: SamplingDecision.RECORD_AND_SAMPLED };
      if (ratio <= 0) return { decision: SamplingDecision.NOT_RECORD };
      return Math.random() < ratio
        ? { decision: SamplingDecision.RECORD_AND_SAMPLED }
        : { decision: SamplingDecision.NOT_RECORD };
    },
    toString() {
      return `RatioSampler(${ratio})`;
    },
  };
}

/**
 * Create a span with the current context (full mode).
 */
export function span<T>(
  name: string,
  fn: (s: { setAttribute: (k: string, v: string | number | boolean) => void; end: () => void }) => T
): T {
  const tracer = otelTrace.getTracer('autotel-web', '1.0.0');
  return tracer.startActiveSpan(name, (s) => {
    try {
      const result = fn({
        setAttribute: (k, v) => s.setAttribute(k, v),
        end: () => s.end(),
      });
      const promise = result as Promise<unknown> | unknown;
      if (promise && typeof (promise as Promise<unknown>).then === 'function') {
        (promise as Promise<unknown>).then(
          () => s.end(),
          (err: unknown) => {
            s.recordException(err as Error);
            s.end();
          }
        );
        return result;
      }
      s.end();
      return result;
    } catch (err) {
      s.recordException(err as Error);
      s.end();
      throw err;
    }
  }) as T;
}

/**
 * Set attribute on the active span (full mode).
 */
export function setAttribute(key: string, value: string | number | boolean): void {
  const activeSpan = otelTrace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute(key, value);
  }
}

/**
 * Add an event to the active span (full mode).
 */
export function addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const activeSpan = otelTrace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent(name, attributes);
  }
}

/**
 * Run a function with the given context (for manual async propagation in full mode).
 */
export function runWithContext<T>(ctx: ReturnType<typeof context.active>, fn: () => T): T {
  return context.with(ctx, fn);
}

/** Re-export for full mode API */
export { trace, getActiveContext, getTraceparent, extractContext } from './functional';
export type { TraceContext } from './functional';

/**
 * Reset full initialization state (for testing).
 * @internal
 */
export function resetFullForTesting(): void {
  isFullInitialized = false;
  if (provider) {
    provider.shutdown();
    provider = undefined;
  }
}
