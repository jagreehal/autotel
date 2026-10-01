/**
 * Console-derived error signals, recorded on the active span.
 *
 * - `console.error(...)` inside a span records an exception on that span
 *   without touching its status: the code handled the error, but it still
 *   belongs to the invocation's issue list.
 * - One log template repeated past a threshold within one invocation (logging
 *   inside a loop) records a single `autotel.LogFlood` exception.
 *
 * Edge runtimes have no console diagnostics channel, so `console` is patched
 * once. The original method is always called. Under Cloudflare native tracing
 * the active span is the native one, so the exception lands in the platform
 * trace.
 */

import { trace as otelTrace } from '@opentelemetry/api';
import {
  getActiveNativeTraceContext,
  getActiveNativeTracer,
  nativeRecordException,
} from './native-bridge';
import type { ResolvedEdgeConfig } from '../types';

/** `exception.type` of the logging-in-a-loop signal. */
export const LOG_FLOOD_EXCEPTION = 'autotel.LogFlood';

const DEFAULT_LOG_FLOOD_THRESHOLD = 100;
const MAX_MESSAGE_LENGTH = 500;
const MAX_TEMPLATE_LENGTH = 120;
// Bounded: the oldest invocation's counts go first once 256 are tracked, so
// memory stays flat and a reported flood is always a real one.
const MAX_INVOCATIONS = 256;
const MAX_TEMPLATES = 256;

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number];

type RecordFn = (exception: Error | string) => void;

interface Target {
  key: string | undefined;
  record: RecordFn;
}

const invocations = new Map<string, Map<string, number>>();
let installed = false;
let busy = false;

/** Collapse ids and numbers so one loop's lines share a template. */
export function logTemplate(args: readonly unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === 'string'
        ? arg.slice(0, 200)
        : arg instanceof Error
          ? arg.name
          : `<${typeof arg}>`,
    )
    .join(' ')
    .replaceAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '<uuid>',
    )
    .replaceAll(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '<hex>')
    .replaceAll(/\d+/g, '<n>');
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** `console.error` arguments as one short message. */
export function formatConsoleArgs(args: readonly unknown[]): string {
  return args
    .map((arg) => stringify(arg))
    .join(' ')
    .slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Count one line against its invocation. Returns true exactly once per
 * invocation and template: on the call that pushes it past `threshold`.
 */
export function countLogLine(
  key: string,
  template: string,
  threshold: number,
): boolean {
  let templates = invocations.get(key);
  if (!templates) {
    if (invocations.size >= MAX_INVOCATIONS) {
      invocations.delete(invocations.keys().next().value as string);
    }
    templates = new Map();
    invocations.set(key, templates);
  }
  const count = (templates.get(template) ?? 0) + 1;
  if (count > 1 || templates.size < MAX_TEMPLATES) {
    templates.set(template, count);
  }
  return count === threshold + 1;
}

/** The `autotel.LogFlood` exception for a template. */
export function logFloodException(template: string, threshold: number): Error {
  const error = new Error(
    `"${template.slice(0, MAX_TEMPLATE_LENGTH)}" logged ${threshold}+ times in one invocation`,
  );
  error.name = LOG_FLOOD_EXCEPTION;
  return error;
}

function activeTarget(): Target | undefined {
  const native = getActiveNativeTraceContext();
  if (native) {
    return {
      key: native.traceId || native.correlationId || undefined,
      record: (e) => native.recordException(toError(e)),
    };
  }
  const span = otelTrace.getActiveSpan();
  if (span) {
    if (!span.isRecording()) return undefined;
    return {
      key: span.spanContext().traceId,
      record: (e) => span.recordException(e),
    };
  }
  const tracer = getActiveNativeTracer();
  const nativeSpan = tracer?.getActiveSpan?.();
  if (!nativeSpan) return undefined;
  return {
    key: tracer?.correlationId,
    record: (e) => nativeRecordException(nativeSpan, toError(e)),
  };
}

function toError(e: Error | string): Error {
  return typeof e === 'string' ? new Error(e) : e;
}

interface Options {
  captureConsoleErrors: boolean;
  logFloodThreshold: number;
}

function onConsole(
  level: Level,
  args: readonly unknown[],
  options: Options,
): void {
  if (typeof args[0] === 'string' && args[0].startsWith('[autotel')) return;
  const captureError = level === 'error' && options.captureConsoleErrors;
  const threshold = options.logFloodThreshold;
  if (!captureError && threshold <= 0) return;
  const target = activeTarget();
  if (!target) return;
  if (captureError) {
    target.record(
      args.find((a): a is Error => a instanceof Error) ??
        formatConsoleArgs(args),
    );
  }
  if (threshold > 0 && target.key) {
    const template = logTemplate(args);
    if (countLogLine(target.key, template, threshold)) {
      target.record(logFloodException(template, threshold));
    }
  }
}

/** Run autotel's own console output without it counting as app logging. */
export function runInternal<T>(fn: () => T): T {
  if (busy) return fn();
  busy = true;
  try {
    return fn();
  } finally {
    busy = false;
  }
}

/**
 * Patch `console` once. Per-call options come from the active config, so a
 * config that opts out does so for its own invocations.
 */
export function installConsoleSignals(
  getConfig: () => ResolvedEdgeConfig | null,
): void {
  if (installed) return;
  installed = true;
  for (const level of LEVELS) {
    const original = console[level];
    console[level] = function (...args: unknown[]) {
      if (!busy) {
        busy = true;
        try {
          const config = getConfig();
          onConsole(level, args, {
            captureConsoleErrors: config?.captureConsoleErrors ?? true,
            logFloodThreshold:
              config?.logFloodThreshold ?? DEFAULT_LOG_FLOOD_THRESHOLD,
          });
        } catch {
          // Telemetry must never break logging.
        } finally {
          busy = false;
        }
      }
      return Reflect.apply(original, console, args);
    };
  }
}
