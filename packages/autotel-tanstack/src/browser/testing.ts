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
 * Serialized span type (browser stub - mirrors server SerializedSpan).
 *
 * Defined as a `type` (not `interface`) so it is assignable to
 * `Record<string, unknown>` in TypeScript 6+ strict mode.
 */
export type SerializedSpan = {
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
  status: { code: number; message?: string };
  durationMs: number;
};

/**
 * Accepts either a raw `Request` (legacy) or a TanStack Router context
 * object containing `{ request: Request }` (Router 1.168+).
 */
type HandlerInput = Request | { request: Request };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateFileRoute = (path: string) => (options: any) => any;

/**
 * Browser stub: createTestSpansRoute is server-only.
 */
export function createTestSpansRoute(
  createFileRoute: CreateFileRoute,
  path?: string,
): unknown {
  void createFileRoute;
  void path;
  throw new Error('createTestSpansRoute is server-only');
}

/**
 * Browser stub: test-spans handlers are server-only.
 * Returns no-op handlers that always return 404.
 */
export function createTestSpansHandlers(): {
  GET: (input: HandlerInput) => Response;
  DELETE: (input: HandlerInput) => Response;
} {
  return {
    GET(input: HandlerInput): Response {
      void input;
      return Response.json(
        { error: 'createTestSpansHandlers is server-only' },
        { status: 404 },
      );
    },
    DELETE(input: HandlerInput): Response {
      void input;
      return Response.json(
        { error: 'createTestSpansHandlers is server-only' },
        { status: 404 },
      );
    },
  };
}
