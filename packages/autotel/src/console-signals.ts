/**
 * Console-derived error signals, recorded on the active span.
 *
 * - `console.error(...)` inside a span records an exception on that span
 *   without touching its status: the code handled the error, but it still
 *   belongs to the request's issue list.
 * - One log template repeated past a threshold within one trace (logging
 *   inside a loop) records a single `autotel.LogFlood` exception.
 *
 * Listens on Node's `console.*` diagnostics channels, so `console` is never
 * patched and the original output is untouched. Installed once by `init()`.
 * Mirrors `autotel-edge/src/core/console-signals.ts`, which patches `console`
 * because edge runtimes have no such channel.
 */

import { trace } from '@opentelemetry/api';
import { subscribeChannel } from './diagnostics/channel.js';
import { safeRequire } from './node-require.js';

/** `exception.type` of the logging-in-a-loop signal. */
export const LOG_FLOOD_EXCEPTION = 'autotel.LogFlood';

export interface ConsoleSignalsOptions {
  /** Record `console.error` inside a span as a handled exception. Default `true`. */
  captureConsoleErrors?: boolean;
  /** Repeats of one log template per trace before `autotel.LogFlood`. Default `100`; `0` disables. */
  logFloodThreshold?: number;
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_TEMPLATE_LENGTH = 120;
// Bounded: the oldest trace's counts go first once 256 are tracked, so memory
// stays flat and a reported flood is always a real one.
const MAX_INVOCATIONS = 256;
const MAX_TEMPLATES = 256;

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;

const invocations = new Map<string, Map<string, number>>();
let options: Required<ConsoleSignalsOptions> = {
  captureConsoleErrors: true,
  logFloodThreshold: 100,
};
let installed = false;
let busy = false;

const nodeUtil = safeRequire<typeof import('node:util')>('node:util');

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

function countLogLine(key: string, template: string, threshold: number) {
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

function onConsole(level: string, args: readonly unknown[]): void {
  if (busy) return;
  if (typeof args[0] === 'string' && args[0].startsWith('[autotel')) return;
  const captureError = level === 'error' && options.captureConsoleErrors;
  const threshold = options.logFloodThreshold;
  if (!captureError && threshold <= 0) return;
  const span = trace.getActiveSpan();
  if (!span?.isRecording()) return;
  busy = true;
  try {
    if (captureError) {
      span.recordException(
        args.find((a): a is Error => a instanceof Error) ??
          (nodeUtil?.format(...args) ?? args.join(' ')).slice(
            0,
            MAX_MESSAGE_LENGTH,
          ),
      );
    }
    if (threshold > 0) {
      const template = logTemplate(args);
      if (countLogLine(span.spanContext().traceId, template, threshold)) {
        span.recordException({
          name: LOG_FLOOD_EXCEPTION,
          message: `"${template.slice(0, MAX_TEMPLATE_LENGTH)}" logged ${threshold}+ times in one invocation`,
        });
      }
    }
  } catch {
    // Telemetry must never break logging.
  } finally {
    busy = false;
  }
}

/** Subscribe once; later calls only update the options. */
export function installConsoleSignals(next: ConsoleSignalsOptions = {}): void {
  options = {
    captureConsoleErrors: next.captureConsoleErrors ?? true,
    logFloodThreshold: next.logFloodThreshold ?? 100,
  };
  if (installed) return;
  installed = true;
  for (const level of LEVELS) {
    subscribeChannel<unknown[] | { args?: unknown[] }>(
      `console.${level}`,
      (message) =>
        onConsole(
          level,
          Array.isArray(message) ? message : (message?.args ?? []),
        ),
    );
  }
}
