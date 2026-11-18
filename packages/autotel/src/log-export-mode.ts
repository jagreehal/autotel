/**
 * What `init()` exports of the Logs API. Its own module so event emitters can
 * read it without importing `init`.
 */

/**
 * - `all`: every log record (`logs: true`)
 * - `events`: only records with an `eventName` (the default)
 * - `env`: whatever `OTEL_LOGS_EXPORTER` sets up; its exporter sends every record
 * - `off`: nothing (`logs: false`, `AUTOTEL_LOGS=off`, `OTEL_LOGS_EXPORTER=none`)
 */
export type LogExportMode = 'all' | 'events' | 'env' | 'off';

let mode: LogExportMode = 'events';
let warn: ((message: string) => void) | undefined;

/**
 * Called by `init()` with the mode it resolved, and its logger's `warn` when
 * nothing would receive a dropped event.
 */
export function setLogExportMode(
  next: LogExportMode,
  warnWith: ((message: string) => void) | undefined,
): void {
  mode = next;
  warn = warnWith;
}

export function logExportMode(): LogExportMode {
  return mode;
}

/** The logger `init()` configured, once it has run. */
export function logExportWarn(): ((message: string) => void) | undefined {
  return warn;
}
