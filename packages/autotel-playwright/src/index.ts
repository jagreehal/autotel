/**
 * autotel-playwright
 *
 * Playwright fixture that creates one OTel span per test and injects W3C trace
 * context into requests to your API so "test → API" appears as one trace.
 *
 * @example
 * // globalSetup.ts: init({ service: 'e2e-tests' });
 * // In spec:
 * import { test, expect } from 'autotel-playwright';
 * test('checks health', async ({ page }) => {
 *   await page.goto(API_BASE_URL + '/health'); // request gets traceparent
 * });
 * // Node-side API calls with trace context:
 * test('api health', async ({ requestWithTrace }) => {
 *   const res = await requestWithTrace.get(API_BASE_URL + '/health');
 *   expect(res.ok()).toBeTruthy();
 * });
 */

import { test as base } from '@playwright/test';
import type {
  Page,
  APIRequestContext,
  Request as PlaywrightRequest,
} from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import type { AutotelConfig } from 'autotel';
import {
  getTracer,
  getAutotelTracerProvider,
  context as otelContext,
  propagation,
  otelTrace,
  resolveTraceUrl,
  SpanStatusCode,
} from 'autotel';
import {
  serializeSpan,
  TestSpanCollector,
} from 'autotel/test-span-collector';
import type { Context, Span, Tracer } from 'autotel';
import { recordBrowserActivity, type BrowserLogRecord } from './browser';
import { SimpleSpanProcessor } from 'autotel/processors';

const TRACER_NAME = 'playwright-tests';
const TRACER_VERSION = '0.1.0';

let collector: TestSpanCollector | null = null;

interface TracerProviderWithProcessor {
  addSpanProcessor(processor: SimpleSpanProcessor): void;
}

/**
 * The test running in this worker: spans this package started, and their
 * context. Playwright calls the test body outside the fixture's
 * `context.with()`, so `step()` parents here and the fixture serializes its
 * own spans (the collector attaches only when the provider accepts a processor
 * after construction).
 */
let currentTest: { ctx: ReturnType<typeof otelContext.active>; spans: Span[] } | null =
  null;

/** Record a span this package started, for the fixture to serialize. */
function track<S extends Span>(span: S): S {
  currentTest?.spans.push(span);
  return span;
}

/**
 * The ended spans a test started, serialized. Spans from a no-op provider
 * (no `init()`) carry no timing and are skipped.
 */
function serializeOwn(spans: Span[]): ReturnType<typeof serializeSpan>[] {
  return spans
    .filter((span) => 'duration' in span && 'startTime' in span)
    .map((span) => serializeSpan(span as unknown as Parameters<typeof serializeSpan>[0]));
}

function ensureCollector(): TestSpanCollector {
  if (!collector) {
    collector = new TestSpanCollector();
    // The global provider is a proxy; the SDK's provider is its delegate.
    const global = getAutotelTracerProvider() as { getDelegate?: () => unknown };
    const provider = (global.getDelegate?.() ?? global) as object;
    if ('addSpanProcessor' in provider) {
      // SAFETY: the guard above established the method exists. It is not on the
      // TracerProvider interface - only on the SDK's implementation of it, which
      // is what autotel installs.
      (provider as TracerProviderWithProcessor).addSpanProcessor(
        new SimpleSpanProcessor({ exporter: collector }),
      );
    }
  }
  return collector;
}

/** Env keys for API base URL (requests to this origin get trace context injected). */
const ENV_API_BASE_URL = 'API_BASE_URL';
const ENV_API_ORIGIN = 'AUTOTEL_PLAYWRIGHT_API_ORIGIN';

function getApiBaseUrls(): string[] {
  const a = process.env[ENV_API_BASE_URL];
  const b = process.env[ENV_API_ORIGIN];
  const urls: string[] = [];
  if (a) urls.push(a.replace(/\/$/, ''));
  if (b) urls.push(b.replace(/\/$/, ''));
  return [...new Set(urls)];
}

/**
 * Returns true if requestUrl should receive trace headers for the given apiBaseUrls.
 * When a base URL includes a path (e.g. http://localhost:3000/api), only requests
 * whose path starts with that path segment match; same-origin but different path
 * (e.g. /health) must not match to avoid leaking trace context to unrelated endpoints.
 */
function urlMatchesApiOrigin(
  requestUrl: string,
  apiBaseUrls: string[],
): boolean {
  if (apiBaseUrls.length === 0) return false;
  try {
    const u = new URL(requestUrl);
    const requestOrigin = u.origin;
    const requestPathname = u.pathname;
    return apiBaseUrls.some((base) => {
      try {
        const b = new URL(base);
        if (requestOrigin !== b.origin) return false;
        const basePathname = b.pathname.replace(/\/$/, '') || '/';
        if (basePathname === '/') return true;
        return (
          requestPathname === basePathname ||
          requestPathname.startsWith(basePathname + '/')
        );
      } catch {
        return requestUrl.startsWith(base);
      }
    });
  } catch {
    return apiBaseUrls.some((base) => requestUrl.startsWith(base));
  }
}

/** Annotation type for custom span attributes: description should be "key=value" or "key=value1;key2=value2". */
export const AUTOTEL_ATTRIBUTE_ANNOTATION = 'autotel.attribute';

function setAttributesFromAnnotations(
  span: { setAttribute: (k: string, v: string | number | boolean) => void },
  testInfo: { annotations: Array<{ type: string; description?: string }> },
): void {
  for (const a of testInfo.annotations) {
    if (a.type !== AUTOTEL_ATTRIBUTE_ANNOTATION || !a.description) continue;
    const entries = a.description.split(';');
    for (const entry of entries) {
      const parts = entry.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        span.setAttribute(key, value);
      }
    }
  }
}

/** Internal: options for get/post/put/patch/delete/head/fetch, as Playwright types them. */
type RequestOptions = NonNullable<Parameters<APIRequestContext['get']>[1]>;

function mergeTraceHeaders(
  url: string,
  options: RequestOptions | undefined,
  apiBaseUrls: string[],
  carrier: Record<string, string>,
  testName: string,
): RequestOptions {
  const opts = options ?? {};
  if (!urlMatchesApiOrigin(url, apiBaseUrls)) return opts;
  return {
    ...opts,
    headers: {
      ...opts.headers,
      ...carrier,
      'x-test-name': testName,
    },
  };
}

/** Wraps APIRequestContext so requests to API_BASE_URL get trace context injected. */
function createRequestWithTrace(
  request: APIRequestContext,
  apiBaseUrls: string[],
  carrier: Record<string, string>,
  testInfo: TestInfo,
): APIRequestContext {
  const merge = (url: string, options?: RequestOptions) =>
    mergeTraceHeaders(url, options, apiBaseUrls, carrier, testInfo.title);

  // SAFETY: the object below implements every method of APIRequestContext that a
  // test can reach; Playwright's interface also carries internal members it does
  // not expose, which is why the assertion at the end of this return is needed.
  return {
    get: (url: string, options?: RequestOptions) =>
      request.get(url, merge(url, options)),
    post: (url: string, options?: RequestOptions) =>
      request.post(url, merge(url, options)),
    put: (url: string, options?: RequestOptions) =>
      request.put(url, merge(url, options)),
    patch: (url: string, options?: RequestOptions) =>
      request.patch(url, merge(url, options)),
    delete: (url: string, options?: RequestOptions) =>
      request.delete(url, merge(url, options)),
    head: (url: string, options?: RequestOptions) =>
      request.head(url, merge(url, options)),
    fetch: (
      urlOrRequest: string | PlaywrightRequest,
      options?: RequestOptions,
    ) =>
      request.fetch(
        urlOrRequest,
        merge(
          typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url(),
          options,
        ),
      ),
    storageState: (options?: { path?: string }) =>
      request.storageState(options),
    dispose: () => request.dispose(),
  } as APIRequestContext;
}

type OtelTestSpan = {
  carrier: Record<string, string>;
  apiBaseUrls: string[];
  testInfo: TestInfo;
  /** The test's span and its context: browser spans nest under it. */
  span: Span;
  ctx: Context;
  tracer: Tracer;
  /** Browser log records emitted during the test, for its `otel-logs` annotation. */
  logs: BrowserLogRecord[];
};

export const test = base.extend<{
  page: Page;
  requestWithTrace: APIRequestContext;
  _otelTestSpan: OtelTestSpan;
  /**
   * Record the page's requests as spans under the test span, console errors and
   * warnings as events on it, and uncaught page errors as exceptions. Default
   * true; `test.use({ otelBrowserSpans: false })` turns it off.
   */
  otelBrowserSpans: boolean;
}>({
  otelBrowserSpans: [true, { option: true }],
  _otelTestSpan: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      ensureCollector();
      const apiBaseUrls = getApiBaseUrls();
      const tracer = getTracer(TRACER_NAME, TRACER_VERSION);
      const spanName = `e2e:${testInfo.title}`;
      const span = tracer.startSpan(spanName, {
        attributes: {
          'test.title': testInfo.title,
          'test.project': testInfo.project.name,
          'test.file': testInfo.file ?? '',
          'test.line': testInfo.line ?? 0,
        },
      });
      setAttributesFromAnnotations(span, testInfo);
      // Annotations for reporters: bare id for joins, URL for the HTML report.
      // Pushed before the body runs so a crashing test still gets them.
      testInfo.annotations.push({
        type: 'otel-trace-id',
        description: span.spanContext().traceId,
      });
      testInfo.annotations.push({
        type: 'otel-trace',
        description:
          resolveTraceUrl(undefined, span.spanContext().traceId) ??
          span.spanContext().traceId,
      });
      const ctx = otelTrace.setSpan(otelContext.active(), span);
      currentTest = { ctx, spans: [span] };
      const own = currentTest.spans;
      const browserLogs: BrowserLogRecord[] = [];
      const carrier: Record<string, string> = {};
      otelContext.with(ctx, () => {
        propagation.inject(otelContext.active(), carrier);
      });
      try {
        await otelContext.with(ctx, () =>
          use({ carrier, apiBaseUrls, testInfo, span, ctx, tracer, logs: browserLogs }),
        );
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      } finally {
        span.end();
        currentTest = null;
        const traceId = span.spanContext().traceId;
        const rootSpanId = span.spanContext().spanId;
        // The collector sees spans from the test's code too, when it could
        // attach; the spans this package started are always serialized.
        const drained = collector!.drainTrace(traceId, rootSpanId);
        const seen = new Set(drained.map((s) => s.spanId));
        const spans = [
          ...drained,
          ...serializeOwn(own).filter((s) => !seen.has(s.spanId)),
        ];
        if (spans.length > 0) {
          testInfo.annotations.push({
            type: 'otel-spans',
            description: JSON.stringify(spans),
          });
        }
        // The log records the browser produced, each tied to the test's span,
        // so a reporter can show them without reading a log pipeline.
        if (browserLogs.length > 0) {
          testInfo.annotations.push({
            type: 'otel-logs',
            description: JSON.stringify(
              browserLogs.map((record) => ({ spanId: rootSpanId, ...record })),
            ),
          });
        }
      }
    },
    { scope: 'test' },
  ],

  page: async ({ page, _otelTestSpan, otelBrowserSpans }, use) => {
    const { carrier, apiBaseUrls, testInfo } = _otelTestSpan;
    if (apiBaseUrls.length > 0) {
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();
        if (urlMatchesApiOrigin(url, apiBaseUrls)) {
          const headers = {
            ...request.headers(),
            ...carrier,
            'x-test-name': testInfo.title,
          };
          await route.continue({ headers });
        } else {
          await route.continue();
        }
      });
    }
    const { tracer } = _otelTestSpan;
    const stop = otelBrowserSpans
      ? recordBrowserActivity(page, {
          ctx: _otelTestSpan.ctx,
          onLog: (record) => _otelTestSpan.logs.push(record),
          tracer: {
            startSpan: (...args: Parameters<Tracer['startSpan']>) =>
              track(tracer.startSpan(...args)),
          },
        })
      : undefined;
    try {
      await use(page);
    } finally {
      // Before the test span ends and its spans are drained.
      await stop?.();
    }
  },

  requestWithTrace: async ({ request, _otelTestSpan }, use) => {
    const wrapped = createRequestWithTrace(
      request,
      _otelTestSpan.apiBaseUrls,
      _otelTestSpan.carrier,
      _otelTestSpan.testInfo,
    );
    await use(wrapped);
  },
});

export { expect } from '@playwright/test';

export { recordBrowserActivity } from './browser';
export type { BrowserActivityTarget, BrowserLogRecord } from './browser';

// Re-export trace context helpers for DX convenience
export {
  getTraceContext,
  resolveTraceUrl,
  isTracing,
  enrichWithTraceContext,
} from 'autotel';

export type { OtelTraceContext } from 'autotel';

/**
 * Runs a named step as a child span of the current test span. Use inside a test to get
 * step-level spans (e.g. "step:login", "step:navigate") under the test span in the same trace.
 *
 * @example
 * test('user flow', async ({ page }) => {
 *   await step('login', async () => {
 *     await page.click('button[type=submit]');
 *   });
 *   await step('open profile', async () => {
 *     await page.goto('/profile');
 *   });
 * });
 */
export async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const tracer = getTracer(TRACER_NAME, TRACER_VERSION);
  // Inside a test body there is no active span (see `currentTest`); parent the
  // step on the test's span so it joins the test's trace.
  const parent = otelTrace.getSpan(otelContext.active())
    ? otelContext.active()
    : (currentTest?.ctx ?? otelContext.active());
  const span = track(
    tracer.startSpan(
      `step:${name}`,
      { attributes: { 'step.name': name } },
      parent,
    ),
  );
  try {
    return await otelContext.with(otelTrace.setSpan(parent, span), fn);
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Returns a function suitable for Playwright globalSetup that inits autotel.
 * Call autotel.init() with the given options (or defaults) so test spans are exported.
 */
export function createGlobalSetup(
  initOptions?: AutotelConfig,
): () => Promise<void> {
  return async () => {
    const { init } = await import('autotel');
    init({
      service: 'e2e-tests',
      debug: true,
      ...initOptions,
    });
  };
}

/**
 * Serialized span returned by the test-spans endpoint (matches autotel-tanstack/testing SerializedSpan).
 */
/** Span attributes as they survive JSON: OpenTelemetry's value types. */
export type SerializedAttributes = Record<
  string,
  string | number | boolean | Array<string | number | boolean | null>
>;

export interface SerializedSpan {
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes?: SerializedAttributes;
  status: { code: number; message?: string };
  durationMs: number;
}

/**
 * Creates a typed client for the test-spans HTTP endpoint.
 *
 * Pairs with `createTestSpansHandlers()` from `autotel-tanstack/testing`.
 *
 * @param baseUrl - Base URL of the app under test (e.g. 'http://localhost:3100')
 * @param options.path - Path of the test-spans endpoint (default: '/api/test-spans')
 *
 * @example
 * ```typescript
 * const spansClient = createTestSpansClient('http://localhost:3100');
 *
 * test('server function is traced', async ({ request }) => {
 *   await spansClient.clearSpans(request);
 *   await page.goto('/');
 *   // ... trigger action ...
 *   const spans = await spansClient.getSpans(request);
 *   expect(spans.find(s => s.name === 'sendMoney.handler')).toBeDefined();
 * });
 * ```
 */
/** Reads and clears the spans a test server collected. */
export interface TestSpansClient {
  getSpans(request: APIRequestContext): Promise<SerializedSpan[]>;
  clearSpans(request: APIRequestContext): Promise<void>;
}

export function createTestSpansClient(
  baseUrl: string,
  options?: { path?: string },
): TestSpansClient {
  const base = baseUrl.replace(/\/$/, '');
  const path = options?.path ?? '/api/test-spans';
  const url = `${base}${path}`;

  return {
    async getSpans(request: APIRequestContext): Promise<SerializedSpan[]> {
      const res = await request.get(url);
      if (!res.ok()) {
        throw new Error(`GET ${path} failed: ${res.status()}`);
      }
      // SAFETY: this endpoint is autotel's own test-span collector, which answers
      // with { spans }; a non-200 was thrown above.
      const body = (await res.json()) as { spans: SerializedSpan[] };
      return body.spans;
    },

    async clearSpans(request: APIRequestContext): Promise<void> {
      const res = await request.delete(url);
      if (!res.ok()) {
        throw new Error(`DELETE ${path} failed: ${res.status()}`);
      }
    },
  };
}
