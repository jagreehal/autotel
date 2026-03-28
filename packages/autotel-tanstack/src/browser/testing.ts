/**
 * Browser stub for testing module
 *
 * Testing utilities are server-side only.
 * In browser, these return no-op implementations.
 */

/**
 * Test span structure (stub)
 */
export interface TestSpan {
  name: string;
  attributes: Record<string, unknown>;
  status: { code: number; message?: string };
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  duration: number;
}

/**
 * Test collector structure (stub)
 */
export interface TestCollector {
  getSpans(): TestSpan[];
  getSpansByName(name: string): TestSpan[];
  clear(): void;
  waitForSpans(count: number, timeout?: number): Promise<TestSpan[]>;
}

/**
 * Browser stub: Returns empty collector
 */
export function createTestCollector(): TestCollector {
  return {
    getSpans: () => [],
    getSpansByName: () => [],
    clear: () => {},
    waitForSpans: async () => [],
  };
}

/**
 * Browser stub: No-op
 */
export function assertSpanCreated(
  collector: TestCollector,
  name: string,
): void {
  void collector;
  void name;
  // No-op in browser
}

/**
 * Browser stub: No-op
 */
export function assertSpanHasAttribute(
  collector: TestCollector,
  name: string,
  key: string,
  value?: unknown,
): void {
  void collector;
  void name;
  void key;
  void value;
  // No-op in browser
}

/**
 * Serialized span interface (browser stub - mirrors server SerializedSpan).
 */
export interface SerializedSpan {
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
  status: { code: number; message?: string };
  durationMs: number;
}

/**
 * Browser stub: test-spans handlers are server-only.
 * Returns no-op handlers that always return 404.
 */
export function createTestSpansHandlers(): {
  GET: (request: Request) => Response;
  DELETE: (request: Request) => Response;
} {
  return {
    GET(_request: Request): Response {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      void _request;
      return Response.json(
        { error: 'createTestSpansHandlers is server-only' },
        { status: 404 },
      );
    },
    DELETE(_request: Request): Response {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      void _request;
      return Response.json(
        { error: 'createTestSpansHandlers is server-only' },
        { status: 404 },
      );
    },
  };
}
