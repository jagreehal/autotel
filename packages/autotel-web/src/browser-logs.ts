/**
 * Browser console output as OpenTelemetry log records.
 *
 * The package has always had a trace signal and no log signal, which leaves a
 * whole half of what the browser already tells you on the floor: the warnings a
 * library prints before it misbehaves, the errors a framework swallows, the
 * lines the application logs on purpose. None of it reaches Loki or anywhere
 * else, and none of it is joinable to the spans around it.
 *
 * This rides the exporter's existing transport, so console output inherits the
 * retries, the offline queue and the blocked-request breaker rather than
 * needing a second delivery path — and it carries the session, so a log line
 * sits alongside the spans from the same visit.
 *
 * Auto-captured output goes out under the instrumentation scope `console`,
 * distinct from the scope programmatic logs use, so a dashboard can separate
 * "the app said this" from "something the app depends on said this".
 *
 * Distinct from breadcrumbs, which keep the same output *on an exception* for
 * whoever is reading the error. This is for the log pipeline; that is for the
 * error. Turning both on is reasonable.
 */

import { recordLog, type LogSeverity } from './span-exporter';

const LEVELS: {
  method: 'debug' | 'log' | 'info' | 'warn' | 'error';
  severity: LogSeverity;
}[] = [
  { method: 'debug', severity: 'debug' },
  { method: 'log', severity: 'info' },
  { method: 'info', severity: 'info' },
  { method: 'warn', severity: 'warn' },
  { method: 'error', severity: 'error' },
];

const ORDER: LogSeverity[] = ['debug', 'info', 'warn', 'error'];

/** Every line this package prints starts with it. */
const SELF_PREFIX = '[autotel-web]';

export interface ConsoleLogsConfig {
  /** Lowest level to capture. @default 'info' — `debug` is usually noise. */
  minLevel?: LogSeverity;
  /** Applied to each rendered line before it is sent, for PII. */
  redactor?: (text: string) => string;
}

function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Patch `console` so its output is exported as log records. Returns a teardown
 * that puts the original methods back.
 */
export function captureConsoleAsLogs(config: ConsoleLogsConfig): () => void {
  if (typeof console !== 'object') return () => {};

  const floor = ORDER.indexOf(config.minLevel ?? 'info');
  const undo: (() => void)[] = [];

  for (const { method, severity } of LEVELS) {
    if (ORDER.indexOf(severity) < floor) continue;
    const original = console[method] as (...args: unknown[]) => void;
    const patched = (...args: unknown[]): void => {
      // Always call through first: a telemetry failure must never be the reason
      // a developer's console.log did not appear.
      original.apply(console, args);
      try {
        const line = args.map((arg) => render(arg)).join(' ');
        // autotel's own debug output is not the application's. Exporting it
        // would also never settle: in debug mode the exporter narrates every
        // flush, and narrating a flush would queue the record that causes the
        // next one, for as long as the page is open.
        if (line.startsWith(SELF_PREFIX)) return;
        recordLog(
          severity,
          config.redactor ? config.redactor(line) : line,
          {},
          'console',
        );
      } catch {
        // Nothing here is worth an exception in an application's log call.
      }
    };
    // SAFETY: `method` is one of the literal keys in LEVELS, all of which are
    // Console methods; the cast is only to write through the readonly type.
    (console as unknown as Record<string, unknown>)[method] = patched;
    undo.push(() => {
      (console as unknown as Record<string, unknown>)[method] = original;
    });
  }

  return () => {
    for (const fn of undo.reverse()) fn();
  };
}
