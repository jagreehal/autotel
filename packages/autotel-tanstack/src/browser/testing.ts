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
