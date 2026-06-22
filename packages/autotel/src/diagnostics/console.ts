/**
 * Capture `console.*` calls as wide events — without monkey-patching `console`.
 *
 * Node publishes every `console.log` / `info` / `debug` / `warn` / `error` call
 * on a built-in diagnostics channel. {@link captureConsole} subscribes to those
 * channels and turns each call into an OpenTelemetry **log record** (correlated
 * to the active span via trace context by the logs SDK) and/or a **span event**
 * on the active span. Nothing patches the global `console`, so there is no
 * load-order fragility and no interference with other tooling.
 *
 * Opt-in. Call once after `init()` and keep the returned disposer to stop:
 *
 * ```ts
 * import { captureConsole } from 'autotel/diagnostics';
 *
 * const stop = captureConsole();      // every console.* → correlated log record
 * // …later: stop();
 * ```
 *
 * The built-in `console.*` channels are a Stability-1 (experimental) Node API;
 * this module degrades to a no-op where they are unavailable.
 */

import { trace, type Attributes } from '@opentelemetry/api';
import { logs, SeverityNumber, type Logger } from '@opentelemetry/api-logs';
import { safeRequire } from '../node-require.js';
import { subscribeChannel } from './channel.js';

/** Console methods that publish a diagnostics channel. */
export type ConsoleLevel = 'log' | 'info' | 'debug' | 'warn' | 'error';

const ALL_LEVELS: readonly ConsoleLevel[] = [
  'log',
  'info',
  'debug',
  'warn',
  'error',
];

const SEVERITY: Record<ConsoleLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  log: SeverityNumber.INFO,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export interface CaptureConsoleOptions {
  /** Which console methods to capture. Defaults to all five. */
  levels?: readonly ConsoleLevel[];
  /**
   * Where to record captured output:
   * - `'log'` (default): emit an OpenTelemetry log record;
   * - `'span-event'`: add an event to the active span (nothing if no active span);
   * - `'both'`.
   */
  target?: 'log' | 'span-event' | 'both';
  /** Logger name for emitted records. Defaults to `'autotel.console'`. */
  loggerName?: string;
  /** Static attributes merged onto every captured record/event. */
  attributes?: Attributes;
}

type ConsoleMessage = { args?: unknown[] };

const nodeUtil = safeRequire<typeof import('node:util')>('node:util');

/** Format console arguments the way `console` itself would (printf + inspect). */
function formatArgs(args: unknown[]): string {
  if (nodeUtil?.format) return nodeUtil.format(...args);
  return args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Start capturing `console.*` calls as wide events. Returns a disposer that
 * stops capture. Safe to call on runtimes without the console channels (no-op).
 */
export function captureConsole(
  options: CaptureConsoleOptions = {},
): () => void {
  const levels = options.levels ?? ALL_LEVELS;
  const target = options.target ?? 'log';
  const toLog = target === 'log' || target === 'both';
  const toSpan = target === 'span-event' || target === 'both';
  const logger: Logger = logs.getLogger(
    options.loggerName ?? 'autotel.console',
  );

  // Guard against re-entrancy: if recording a captured call itself triggers a
  // `console.*` (e.g. an exporter logging a warning), don't capture that.
  let recording = false;

  const disposers = levels.map((level) =>
    subscribeChannel(`console.${level}`, (message) => {
      if (recording) return;
      const args = (message as ConsoleMessage)?.args ?? [];
      const body = formatArgs(args as unknown[]);
      recording = true;
      try {
        const attributes: Attributes = {
          'log.source': 'console',
          'log.method': level,
          ...options.attributes,
        };
        if (toLog) {
          logger.emit({
            severityNumber: SEVERITY[level],
            severityText: level.toUpperCase(),
            body,
            attributes,
          });
        }
        if (toSpan) {
          trace
            .getActiveSpan()
            ?.addEvent('log', { 'log.message': body, ...attributes });
        }
      } finally {
        recording = false;
      }
    }),
  );

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const dispose of disposers) dispose();
  };
}
