/**
 * Testing Utilities
 *
 * Helpers for testing instrumented code and verifying telemetry.
 * Perfect for integration tests and QA in production validation.
 *
 * @example Verify traces are created
 * ```typescript
 * import { assertTraceCreated, collectTraces } from '@your-org/otel-decorators/testing'
 *
 * describe('UserService', () => {
 *   it('should create trace for user creation', async () => {
 *     const collector = collectTraces()
 *
 *     const service = new UserService()
 *     await service.createUser({ email: 'test@example.com' })
 *
 *     assertTraceCreated(collector, 'user.createUser')
 *   })
 * })
 * ```
 */

import {
  SpanStatusCode,
  type SpanStatus,
  type Attributes,
  type AttributeValue,
  context,
  trace as otelTrace,
  type Span,
  type SpanContext,
  type TimeInput,
  type Exception,
  type Link,
  type SpanOptions,
  type Context as OtelContext,
  type Tracer,
  type SpanKind,
} from '@opentelemetry/api';
import * as nodeAsyncHooks from 'node:async_hooks';
import { type Logger } from './logger';
import { configure } from './config';
import type { UnknownRecord } from './values';
import { asRecord, asString, isFunction } from './values';

// Re-export events testing utilities
export {
  createEventCollector,
  assertEventTracked,
  assertOutcomeTracked,
  type EventCollector,
  type EventData,
  type EventsFunnelStep,
  type EventsOutcome,
  type EventsValue,
} from './event-testing';
export {
  TestSpanCollector,
  serializeSpan,
  type SerializedSpan,
} from './test-span-collector';
export {
  createMemoryExporter,
  type MemoryExporter,
  type RecordedSpan,
} from './memory-exporter';

/**
 * Note: OpenTelemetry exporters and processors have moved to dedicated modules
 * for better semantic clarity.
 *
 * For exporters (ConsoleSpanExporter, InMemorySpanExporter):
 * @see {@link autotel/exporters}
 *
 * For processors (SimpleSpanProcessor, BatchSpanProcessor):
 * @see {@link autotel/processors}
 *
 * This module focuses on high-level testing utilities with assertion helpers
 * and trace collectors.
 *
 * @example High-level testing (recommended)
 * ```typescript
 * import { createTraceCollector, assertTraceCreated } from 'autotel/testing'
 *
 * const collector = createTraceCollector()
 * await myService.doSomething()
 * assertTraceCreated(collector, 'myService.doSomething')
 * ```
 *
 * @example Low-level testing (when you need raw OTel spans)
 * ```typescript
 * import { InMemorySpanExporter } from 'autotel/exporters'
 * import { SimpleSpanProcessor } from 'autotel/processors'
 *
 * const exporter = new InMemorySpanExporter()
 * init({ service: 'test', spanProcessor: new SimpleSpanProcessor(exporter) })
 * ```
 */

/**
 * Simplified span representation for testing
 */
export interface TestSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  kind?: SpanKind;
  name: string;
  status: SpanStatus;
  attributes: Attributes;
  events: Array<{ name: string; attributes?: Attributes }>;
  links: Link[];
  startTime: number;
  endTime: number;
  duration: number;
}

export interface SpanMatch {
  name?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  kind?: SpanKind;
  attributes?: Attributes;
}

/**
 * In-memory trace collector for testing
 */
export interface TraceCollector {
  /** Get all collected spans */
  getSpans(): TestSpan[];
  /** Get spans matching a name */
  getSpansByName(name: string): TestSpan[];
  /** Get spans matching attributes */
  getSpansByAttributes(attributes: Attributes): TestSpan[];
  /** Get spans belonging to a trace */
  getSpansByTraceId(traceId: string): TestSpan[];
  /** Get spans without a recorded parent */
  getRootSpans(): TestSpan[];
  /** Get all descendants of a span, ordered by completion */
  getDescendants(rootSpanId: string): TestSpan[];
  /** Find exactly one span or throw an actionable assertion error */
  expectSpan(criteria: string | SpanMatch): TestSpan;
  /** Clear all collected spans */
  clear(): void;
  /** Record a span (internal use) */
  recordSpan(span: TestSpan): void;
}

/**
 * Create an in-memory trace collector for testing
 *
 * IMPORTANT: This automatically configures the global tracer to record spans.
 * Call this in your test's beforeEach() to ensure proper setup.
 *
 * @example
 * ```typescript
 * import { createTraceCollector } from 'autotel/testing'
 *
 * describe('MyService', () => {
 *   let collector: TraceCollector
 *
 *   beforeEach(() => {
 *     collector = createTraceCollector()
 *   })
 *
 *   it('should trace operations', async () => {
 *     await myService.doSomething()
 *
 *     const spans = collector.getSpansByName('myService.doSomething')
 *     expect(spans).toHaveLength(1)
 *   })
 * })
 * ```
 */
export function createTraceCollector(): TraceCollector {
  const spans: TestSpan[] = [];
  const activeMockSpanStorage = new nodeAsyncHooks.AsyncLocalStorage<Span>();
  let nextTraceId = 1;
  let nextSpanId = 1;

  const hexId = (value: number, length: number) =>
    value.toString(16).padStart(length, '0');

  // Create mock span that captures data and implements full Span interface
  const createMockSpan = (
    name: string,
    startTime: number,
    parentSpanContext?: SpanContext,
    options?: SpanOptions,
  ): Span => {
    const spanContextData: SpanContext = {
      traceId: parentSpanContext?.traceId ?? hexId(nextTraceId++, 32),
      spanId: hexId(nextSpanId++, 16),
      traceFlags: 1,
      isRemote: false,
    };
    const spanData: Partial<TestSpan> = {
      traceId: spanContextData.traceId,
      spanId: spanContextData.spanId,
      parentSpanId: parentSpanContext?.spanId,
      kind: options?.kind,
      name,
      startTime,
      attributes: {},
      events: [],
      links: [],
      status: { code: SpanStatusCode.OK },
    };

    const mockSpan: Span = {
      spanContext: () => spanContextData,

      setStatus(status: SpanStatus) {
        spanData.status = status;
        return this;
      },

      setAttributes(attributes: Attributes) {
        spanData.attributes = { ...spanData.attributes, ...attributes };
        return this;
      },

      setAttribute(key: string, value: AttributeValue) {
        spanData.attributes = spanData.attributes || {};
        spanData.attributes[key] = value;
        return this;
      },

      addEvent(
        name: string,
        attributesOrStartTime?: Attributes | TimeInput,
        startTime?: TimeInput,
      ) {
        // SAFETY: addEvent's overloads put either attributes or a start time
        // in this position; a record here is the attributes.
        const attributes = asRecord(attributesOrStartTime) as
          Attributes | undefined;
        spanData.events!.push({ name, attributes });
        void startTime;
        return this;
      },

      addLink(link: { context: SpanContext; attributes?: Attributes }) {
        spanData.links!.push(link);
        return this;
      },

      addLinks(
        links: Array<{ context: SpanContext; attributes?: Attributes }>,
      ) {
        spanData.links!.push(...links);
        return this;
      },

      updateName(newName: string) {
        spanData.name = newName;
        return this;
      },

      isRecording() {
        return true;
      },

      recordException(exception: Exception, time?: TimeInput) {
        void exception;
        void time;
      },

      end(endTimeArg?: TimeInput) {
        void endTimeArg;
        const endTime = performance.now();
        spans.push({
          traceId: spanData.traceId!,
          spanId: spanData.spanId!,
          parentSpanId: spanData.parentSpanId,
          kind: spanData.kind,
          name: spanData.name!,
          status: spanData.status!,
          attributes: spanData.attributes || {},
          events: spanData.events || [],
          links: spanData.links || [],
          startTime: spanData.startTime!,
          endTime,
          duration: endTime - spanData.startTime!,
        });
      },
    };

    return mockSpan;
  };

  // Create mock tracer
  const mockTracer: Tracer = {
    startSpan(name: string, options?: SpanOptions, ctx?: OtelContext): Span {
      const startTime = performance.now();
      const parent =
        (ctx ? otelTrace.getSpan(ctx)?.spanContext() : undefined) ??
        activeMockSpanStorage.getStore()?.spanContext();
      return createMockSpan(name, startTime, parent, options);
    },

    startActiveSpan<F extends (span: Span) => unknown>(
      name: string,
      optionsOrFn: SpanOptions | F,
      contextOrFn?: OtelContext | F,
      fn?: F,
    ): ReturnType<F> {
      // The callback is whichever argument is callable; OTel allows it in any
      // of the three positions. typeof, not isFunction: this narrows a union
      // of a callback and a context, and only the operator TypeScript
      // understands can tell the rest of the body which one it has.
      const callback =
        typeof optionsOrFn === 'function'
          ? optionsOrFn
          : typeof contextOrFn === 'function'
            ? contextOrFn
            : fn;
      if (!callback) throw new Error('startActiveSpan requires a callback');

      const startTime = performance.now();
      const suppliedContext =
        typeof optionsOrFn === 'function' ||
        typeof contextOrFn === 'function' ||
        contextOrFn === undefined
          ? context.active()
          : contextOrFn;
      const parent =
        otelTrace.getSpan(suppliedContext)?.spanContext() ??
        activeMockSpanStorage.getStore()?.spanContext();
      const spanOptions =
        typeof optionsOrFn === 'function' ? undefined : optionsOrFn;
      const mockSpan = createMockSpan(name, startTime, parent, spanOptions);

      // Set span as active in context (makes otelTrace.getActiveSpan() work)
      const ctx = otelTrace.setSpan(suppliedContext, mockSpan);
      return activeMockSpanStorage.run(mockSpan, () => {
        // SAFETY: the callback is the caller's own F, so what it returns is
        // ReturnType<F>; context.with only passes the value through.
        return context.with(ctx, () => callback(mockSpan)) as ReturnType<F>;
      });
    },
  };

  // Auto-configure global tracer
  configure({ tracer: mockTracer });

  return {
    getSpans(): TestSpan[] {
      return [...spans];
    },

    getSpansByName(name: string): TestSpan[] {
      return spans.filter((span) => span.name === name);
    },

    getSpansByAttributes(attributes: Attributes): TestSpan[] {
      return spans.filter((span) => {
        return Object.entries(attributes).every(
          ([key, value]) => span.attributes[key] === value,
        );
      });
    },

    getSpansByTraceId(traceId: string): TestSpan[] {
      return spans.filter((span) => span.traceId === traceId);
    },

    getRootSpans(): TestSpan[] {
      return spans.filter((span) => span.parentSpanId === undefined);
    },

    getDescendants(rootSpanId: string): TestSpan[] {
      const included = new Set([rootSpanId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const span of spans) {
          if (
            span.parentSpanId &&
            included.has(span.parentSpanId) &&
            !included.has(span.spanId)
          ) {
            included.add(span.spanId);
            changed = true;
          }
        }
      }
      included.delete(rootSpanId);
      return spans.filter((span) => included.has(span.spanId));
    },

    expectSpan(criteria: string | SpanMatch): TestSpan {
      // typeof, not asString: the else branch needs criteria narrowed to
      // SpanMatch, which only the operator TypeScript understands does.
      const matches =
        typeof criteria === 'string'
          ? spans.filter((span) => span.name === criteria)
          : spans.filter((span) => {
              if (criteria.name !== undefined && span.name !== criteria.name) {
                return false;
              }
              if (
                criteria.traceId !== undefined &&
                span.traceId !== criteria.traceId
              ) {
                return false;
              }
              if (
                criteria.spanId !== undefined &&
                span.spanId !== criteria.spanId
              ) {
                return false;
              }
              if (
                criteria.parentSpanId !== undefined &&
                span.parentSpanId !== criteria.parentSpanId
              ) {
                return false;
              }
              if (criteria.kind !== undefined && span.kind !== criteria.kind) {
                return false;
              }
              return Object.entries(criteria.attributes ?? {}).every(
                ([key, value]) => span.attributes[key] === value,
              );
            });
      if (matches.length !== 1) {
        throw new Error(
          `Expected exactly one span matching ${JSON.stringify(criteria)}, found ${matches.length}`,
        );
      }
      return matches[0]!;
    },

    clear(): void {
      spans.length = 0;
    },

    recordSpan(span: TestSpan): void {
      spans.push(span);
    },
  };
}

/**
 * Assert that a trace was created for an operation
 *
 * @param collector - Trace collector
 * @param operationName - Expected operation name
 * @param options - Optional assertion options
 * @throws Error if trace was not found or doesn't match expectations
 *
 * @example
 * ```typescript
 * assertTraceCreated(collector, 'user.createUser')
 * assertTraceCreated(collector, 'user.createUser', {
 *   minCount: 1,
 *   maxCount: 1,
 *   status: SpanStatusCode.OK,
 *   attributes: { 'user.email': 'test@example.com' }
 * })
 * ```
 */
export function assertTraceCreated(
  collector: TraceCollector,
  operationName: string,
  options?: {
    minCount?: number;
    maxCount?: number;
    status?: SpanStatusCode;
    attributes?: Attributes;
  },
): void {
  const spans = collector.getSpansByName(operationName);

  if (options?.minCount !== undefined && spans.length < options.minCount) {
    throw new Error(
      `Expected at least ${options.minCount} traces for ${operationName}, got ${spans.length}`,
    );
  }

  if (options?.maxCount !== undefined && spans.length > options.maxCount) {
    throw new Error(
      `Expected at most ${options.maxCount} traces for ${operationName}, got ${spans.length}`,
    );
  }

  if (spans.length === 0) {
    throw new Error(`No traces found for operation: ${operationName}`);
  }

  if (options?.status !== undefined) {
    const matchingSpans = spans.filter(
      (span) => span.status.code === options.status,
    );
    if (matchingSpans.length === 0) {
      throw new Error(
        `No traces with status ${options.status} found for ${operationName}`,
      );
    }
  }

  if (options?.attributes) {
    const matchingSpans = spans.filter((span) => {
      return Object.entries(options.attributes!).every(
        ([key, value]) => span.attributes[key] === value,
      );
    });
    if (matchingSpans.length === 0) {
      throw new Error(
        `No traces with attributes ${JSON.stringify(options.attributes)} found for ${operationName}`,
      );
    }
  }
}

/**
 * Assert that no errors were logged
 *
 * Use this in smoke tests to verify critical paths don't have errors.
 *
 * @param collector - Trace collector
 * @throws Error if any error traces are found
 *
 * @example
 * ```typescript
 * // Run critical user flows
 * await runSmokeTests()
 *
 * // Verify no errors occurred
 * assertNoErrors(collector)
 * ```
 */
export function assertNoErrors(collector: TraceCollector): void {
  const errorSpans = collector
    .getSpans()
    .filter((span) => span.status.code === SpanStatusCode.ERROR);

  if (errorSpans.length > 0) {
    const errorSummary = errorSpans
      .map((span) => `${span.name}: ${span.status.message}`)
      .join('\n');
    throw new Error(`Found ${errorSpans.length} error spans:\n${errorSummary}`);
  }
}

/**
 * Assert that a trace was created and succeeded
 *
 * @param collector - Trace collector
 * @param operationName - Expected operation name
 *
 * @example
 * ```typescript
 * assertTraceSucceeded(collector, 'user.createUser')
 * ```
 */
export function assertTraceSucceeded(
  collector: TraceCollector,
  operationName: string,
): void {
  assertTraceCreated(collector, operationName, { status: SpanStatusCode.OK });
}

/**
 * Assert that a trace was created and failed
 *
 * @param collector - Trace collector
 * @param operationName - Expected operation name
 * @param errorMessage - Optional expected error message
 *
 * @example
 * ```typescript
 * assertTraceFailed(collector, 'user.createUser', 'Invalid email')
 * ```
 */
export function assertTraceFailed(
  collector: TraceCollector,
  operationName: string,
  errorMessage?: string,
): void {
  const spans = collector.getSpansByName(operationName);

  if (spans.length === 0) {
    throw new Error(`No traces found for operation: ${operationName}`);
  }

  const errorSpans = spans.filter(
    (span) => span.status.code === SpanStatusCode.ERROR,
  );

  if (errorSpans.length === 0) {
    throw new Error(`No error traces found for operation: ${operationName}`);
  }

  if (errorMessage) {
    const matchingSpans = errorSpans.filter(
      (span) => span.status.message === errorMessage,
    );
    if (matchingSpans.length === 0) {
      throw new Error(
        `No error traces with message "${errorMessage}" found for ${operationName}`,
      );
    }
  }
}

/**
 * In-memory log collector for testing
 */
export interface LogCollector {
  /** Get all collected logs */
  getLogs(): LogEntry[];
  /** Get logs by level */
  getLogsByLevel(level: 'info' | 'warn' | 'error' | 'debug'): LogEntry[];
  /** Get logs containing a message */
  getLogsByMessage(message: string): LogEntry[];
  /** Clear all collected logs */
  clear(): void;
}

/**
 * Log entry
 */
export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  extra?: UnknownRecord;
  error?: Error;
}

/**
 * Create an in-memory log collector for testing
 *
 * @example
 * ```typescript
 * const logger = createMockLogger()
 *
 * // Use logger in your code
 * service.log = logger
 * await service.doSomething()
 *
 * // Assert logs were created
 * const logs = logger.getLogs()
 * expect(logs).toHaveLength(2)
 * expect(logs[0].message).toBe('Operation started')
 * ```
 */
export function createMockLogger(): Logger & LogCollector {
  const logs: LogEntry[] = [];

  // Pino-compatible signature: supports both:
  // - logger.info('message') - string only
  // - logger.info({ extra }, 'message') - object first with optional message
  const createLogMethod = (level: 'info' | 'warn' | 'debug') => {
    return (objOrMsg: UnknownRecord | string, msg?: string): void => {
      const message = asString(objOrMsg);
      logs.push(
        message === undefined
          ? // Pino style: logger.info({ extra }, 'message')
            { level, message: msg || '', extra: asRecord(objOrMsg) }
          : // String-only call: logger.info('message')
            { level, message, extra: undefined },
      );
    };
  };

  return {
    info: createLogMethod('info'),
    warn: createLogMethod('warn'),
    debug: createLogMethod('debug'),

    error(objOrMsg: UnknownRecord | string, msg?: string): void {
      const message = asString(objOrMsg);
      if (message !== undefined) {
        // String-only call: logger.error('message')
        logs.push({
          level: 'error',
          message,
          extra: undefined,
          error: undefined,
        });
        return;
      }

      // Pino style: logger.error({ err, ...extra }, 'message')
      // Extract err from extra if present (Pino convention)
      const { err, ...rest } = asRecord(objOrMsg) ?? {};
      logs.push({
        level: 'error',
        message: msg || '',
        error: err instanceof Error ? err : undefined,
        extra:
          err !== undefined && !(err instanceof Error)
            ? { err, ...rest }
            : rest,
      });
    },

    getLogs(): LogEntry[] {
      return [...logs];
    },

    getLogsByLevel(level: 'info' | 'warn' | 'error' | 'debug'): LogEntry[] {
      return logs.filter((log) => log.level === level);
    },

    getLogsByMessage(message: string): LogEntry[] {
      return logs.filter((log) => log.message.includes(message));
    },

    clear(): void {
      logs.length = 0;
    },
  };
}

/**
 * Assert that no error logs were created
 *
 * @param logger - Log collector
 * @throws Error if any error logs are found
 *
 * @example
 * ```typescript
 * assertNoErrorsLogged(logger)
 * ```
 */
export function assertNoErrorsLogged(logger: LogCollector): void {
  const errorLogs = logger.getLogsByLevel('error');

  if (errorLogs.length > 0) {
    const errorSummary = errorLogs
      .map(
        (log) => `${log.message}${log.error ? ': ' + log.error.message : ''}`,
      )
      .join('\n');
    throw new Error(`Found ${errorLogs.length} error logs:\n${errorSummary}`);
  }
}

/**
 * Wait for a specific trace to be created
 *
 * Useful for async operations where you need to wait for telemetry.
 *
 * @param collector - Trace collector
 * @param operationName - Expected operation name
 * @param timeoutMs - Timeout in milliseconds (default 5000)
 * @returns Promise that resolves when trace is found
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * // Start async operation
 * const promise = service.doAsyncWork()
 *
 * // Wait for trace
 * await waitForTrace(collector, 'service.doAsyncWork', 1000)
 *
 * // Now you can assert on the trace
 * assertTraceSucceeded(collector, 'service.doAsyncWork')
 * ```
 */
export async function waitForTrace(
  collector: TraceCollector,
  operationName: string,
  timeoutMs: number = 5000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const spans = collector.getSpansByName(operationName);
    if (spans.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(
    `Timeout waiting for trace ${operationName} after ${timeoutMs}ms`,
  );
}

/**
 * Get trace duration in milliseconds
 *
 * @param collector - Trace collector
 * @param operationName - Operation name
 * @returns Duration in milliseconds, or undefined if trace not found
 *
 * @example
 * ```typescript
 * const duration = getTraceDuration(collector, 'user.createUser')
 * expect(duration).toBeLessThan(1000) // Should be < 1s
 * ```
 */
export function getTraceDuration(
  collector: TraceCollector,
  operationName: string,
): number | undefined {
  const spans = collector.getSpansByName(operationName);
  if (spans.length === 0) {
    return undefined;
  }

  return spans[0]?.duration;
}

/**
 * Assert that an operation completed within a time threshold
 *
 * Perfect for performance testing and SLO validation.
 *
 * @param collector - Trace collector
 * @param operationName - Operation name
 * @param maxDurationMs - Maximum allowed duration in milliseconds
 * @throws Error if operation took too long
 *
 * @example
 * ```typescript
 * // Verify operation meets SLO
 * await service.createUser({ email: 'test@example.com' })
 * assertTraceDuration(collector, 'user.createUser', 500) // Must be < 500ms
 * ```
 */
export function assertTraceDuration(
  collector: TraceCollector,
  operationName: string,
  maxDurationMs: number,
): void {
  const duration = getTraceDuration(collector, operationName);

  if (duration === undefined) {
    throw new Error(`No trace found for operation: ${operationName}`);
  }

  if (duration > maxDurationMs) {
    throw new Error(
      `Operation ${operationName} took ${duration.toFixed(2)}ms, exceeding ${maxDurationMs}ms threshold`,
    );
  }
}
