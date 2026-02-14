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
import type { Page, APIRequestContext, Request as PlaywrightRequest } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import type { AutotelConfig } from 'autotel';
import {
  getTracer,
  getAutotelTracerProvider,
  context as otelContext,
  propagation,
  otelTrace,
  SpanStatusCode,
} from 'autotel';
import { TestSpanCollector } from 'autotel/test-span-collector';
import { SimpleSpanProcessor } from 'autotel/processors';

const TRACER_NAME = 'playwright-tests';
const TRACER_VERSION = '0.1.0';

let collector: TestSpanCollector | null = null;

interface TracerProviderWithProcessor {
  addSpanProcessor(processor: unknown): void;
}

function ensureCollector(): TestSpanCollector {
  if (!collector) {
    collector = new TestSpanCollector();
    const provider = getAutotelTracerProvider();
    if ('addSpanProcessor' in provider) {
      (provider as TracerProviderWithProcessor).addSpanProcessor(
        new SimpleSpanProcessor(collector),
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
function urlMatchesApiOrigin(requestUrl: string, apiBaseUrls: string[]): boolean {
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
          requestPathname === basePathname || requestPathname.startsWith(basePathname + '/')
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

/** Internal: options for get/post/put/patch/delete/head/fetch that may include headers. */
type RequestOptions = Record<string, unknown> & { headers?: Record<string, string> };

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
    headers: { ...(opts.headers as Record<string, string>), ...carrier, 'x-test-name': testName },
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

  return {
    get: (url: string, options?: RequestOptions) => request.get(url, merge(url, options)),
    post: (url: string, options?: RequestOptions) => request.post(url, merge(url, options)),
    put: (url: string, options?: RequestOptions) => request.put(url, merge(url, options)),
    patch: (url: string, options?: RequestOptions) => request.patch(url, merge(url, options)),
    delete: (url: string, options?: RequestOptions) => request.delete(url, merge(url, options)),
    head: (url: string, options?: RequestOptions) => request.head(url, merge(url, options)),
    fetch: (urlOrRequest: string | PlaywrightRequest, options?: RequestOptions) =>
      request.fetch(urlOrRequest, merge(typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url(), options)),
    storageState: (options?: { path?: string }) => request.storageState(options),
    dispose: () => request.dispose(),
  } as APIRequestContext;
}

type OtelTestSpan = {
  carrier: Record<string, string>;
  apiBaseUrls: string[];
  testInfo: TestInfo;
};

export const test = base.extend<{
  page: Page;
  requestWithTrace: APIRequestContext;
  _otelTestSpan: OtelTestSpan;
}>({
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
      const ctx = otelTrace.setSpan(otelContext.active(), span);
      const carrier: Record<string, string> = {};
      propagation.inject(ctx, carrier);
      try {
        await use({ carrier, apiBaseUrls, testInfo });
      } finally {
        span.end();
        const traceId = span.spanContext().traceId;
        const rootSpanId = span.spanContext().spanId;
        const spans = collector!.drainTrace(traceId, rootSpanId);
        if (spans.length > 0) {
          testInfo.annotations.push({
            type: 'otel-spans',
            description: JSON.stringify(spans),
          });
        }
      }
    },
    { scope: 'test' },
  ],

  page: async ({ page, _otelTestSpan }, use) => {
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
    await use(page);
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
  const span = tracer.startSpan(`step:${name}`, {
    attributes: { 'step.name': name },
  });
  try {
    return await otelContext.with(otelTrace.setSpan(otelContext.active(), span), fn);
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown error' });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Returns a function suitable for Playwright globalSetup that inits autotel.
 * Call autotel.init() with the given options (or defaults) so test spans are exported.
 */
export function createGlobalSetup(initOptions?: AutotelConfig): () => Promise<void> {
  return async () => {
    const { init } = await import('autotel');
    init({
      service: 'e2e-tests',
      debug: true,
      ...initOptions,
    });
  };
}
