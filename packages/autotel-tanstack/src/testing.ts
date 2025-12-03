import { type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { init } from 'autotel';

/**
 * Test harness for TanStack instrumentation testing
 *
 * Provides utilities for testing TanStack Start applications
 * with autotel-tanstack instrumentation.
 */
export interface TestHarness {
  /**
   * The in-memory span exporter
   */
  exporter: {
    getFinishedSpans(): ReadableSpan[];
    reset(): void;
  };

  /**
   * Get all finished spans
   */
  getSpans(): ReadableSpan[];

  /**
   * Get spans by name (exact match or regex)
   */
  getSpansByName(name: string | RegExp): ReadableSpan[];

  /**
   * Get spans by TanStack type
   */
  getSpansByType(
    type: 'request' | 'serverFn' | 'loader' | 'beforeLoad',
  ): ReadableSpan[];

  /**
   * Reset collected spans
   */
  reset(): void;

  /**
   * Assert a span exists
   */
  assertSpanExists(name: string | RegExp): void;

  /**
   * Assert a span has a specific attribute
   */
  assertSpanHasAttribute(
    name: string | RegExp,
    attr: string,
    value?: unknown,
  ): void;

  /**
   * Assert a server function was traced
   */
  assertServerFnTraced(name: string): void;

  /**
   * Assert a loader was traced
   */
  assertLoaderTraced(routeId: string): void;

  /**
   * Assert a beforeLoad was traced
   */
  assertBeforeLoadTraced(routeId: string): void;

  /**
   * Assert an HTTP request was traced
   */
  assertRequestTraced(method: string, path: string): void;
}

/**
 * Create a test harness for TanStack instrumentation testing
 *
 * This sets up autotel with an in-memory exporter for testing.
 * Call this in your test setup to capture and assert on spans.
 *
 * @returns Test harness with assertion helpers
 *
 * @example
 * ```typescript
 * import { describe, it, beforeEach } from 'vitest';
 * import { createTestHarness } from 'autotel-tanstack/testing';
 *
 * describe('MyServerFunction', () => {
 *   let harness: ReturnType<typeof createTestHarness>;
 *
 *   beforeEach(() => {
 *     harness = createTestHarness();
 *   });
 *
 *   afterEach(() => {
 *     harness.reset();
 *   });
 *
 *   it('should trace the server function', async () => {
 *     await myServerFunction({ id: '123' });
 *
 *     harness.assertServerFnTraced('myServerFunction');
 *     harness.assertSpanHasAttribute(
 *       /tanstack\.serverFn/,
 *       'tanstack.server_function.name',
 *       'myServerFunction'
 *     );
 *   });
 * });
 * ```
 */
export function createTestHarness(): TestHarness {
  const exporter = new InMemorySpanExporter();

  init({
    service: 'test',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  function getSpans(): ReadableSpan[] {
    return exporter.getFinishedSpans() as ReadableSpan[];
  }

  function getSpansByName(name: string | RegExp): ReadableSpan[] {
    const spans = getSpans();
    if (typeof name === 'string') {
      return spans.filter((s) => s.name === name);
    }
    return spans.filter((s) => name.test(s.name));
  }

  function getSpansByType(
    type: 'request' | 'serverFn' | 'loader' | 'beforeLoad',
  ): ReadableSpan[] {
    return getSpans().filter((s) => s.attributes['tanstack.type'] === type);
  }

  function reset(): void {
    exporter.reset();
  }

  function assertSpanExists(name: string | RegExp): void {
    const spans = getSpansByName(name);
    if (spans.length === 0) {
      const allSpanNames = getSpans().map((s) => s.name);
      throw new Error(
        `Expected span "${name}" to exist. Found spans: ${JSON.stringify(allSpanNames)}`,
      );
    }
  }

  function assertSpanHasAttribute(
    name: string | RegExp,
    attr: string,
    value?: unknown,
  ): void {
    const spans = getSpansByName(name);
    if (spans.length === 0) {
      throw new Error(`Span "${name}" not found`);
    }

    const span = spans[0];
    const attrValue = span.attributes[attr];

    if (attrValue === undefined) {
      throw new Error(
        `Attribute "${attr}" not found on span "${span.name}". ` +
          `Available attributes: ${JSON.stringify(Object.keys(span.attributes))}`,
      );
    }

    if (value !== undefined && attrValue !== value) {
      throw new Error(
        `Expected attribute "${attr}" to be "${value}", got "${attrValue}"`,
      );
    }
  }

  function assertServerFnTraced(name: string): void {
    assertSpanExists(`tanstack.serverFn.${name}`);
  }

  function assertLoaderTraced(routeId: string): void {
    assertSpanExists(`tanstack.loader.${routeId}`);
  }

  function assertBeforeLoadTraced(routeId: string): void {
    assertSpanExists(`tanstack.beforeLoad.${routeId}`);
  }

  function assertRequestTraced(method: string, path: string): void {
    assertSpanExists(`${method} ${path}`);
  }

  return {
    exporter,
    getSpans,
    getSpansByName,
    getSpansByType,
    reset,
    assertSpanExists,
    assertSpanHasAttribute,
    assertServerFnTraced,
    assertLoaderTraced,
    assertBeforeLoadTraced,
    assertRequestTraced,
  };
}

/**
 * Mock request factory for testing
 *
 * Creates mock Request objects for testing middleware and handlers.
 *
 * @example
 * ```typescript
 * const request = createMockRequest('GET', '/api/users', {
 *   headers: { 'x-request-id': 'test-123' },
 * });
 * ```
 */
export function createMockRequest(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: string;
    traceparent?: string;
  } = {},
): Request {
  const headers = new Headers(options.headers);

  if (options.traceparent) {
    headers.set('traceparent', options.traceparent);
  }

  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: options.body,
  });
}

/**
 * Generate a valid W3C traceparent header for testing
 *
 * @param traceId - Optional 32-char hex trace ID
 * @param spanId - Optional 16-char hex span ID
 * @returns Valid traceparent header string
 *
 * @example
 * ```typescript
 * const traceparent = generateTraceparent();
 * const request = createMockRequest('GET', '/api/users', { traceparent });
 * ```
 */
export function generateTraceparent(traceId?: string, spanId?: string): string {
  const version = '00';
  const trace = traceId || generateHex(32);
  const span = spanId || generateHex(16);
  const flags = '01'; // Sampled

  return `${version}-${trace}-${span}-${flags}`;
}

function generateHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}
