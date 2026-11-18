import {
  logs,
  SeverityNumber,
  type Attributes,
  type Context,
  type LogRecord,
} from '@opentelemetry/api';
import { logExportMode, logExportWarn } from './log-export-mode';

let warnedLogsOff = false;

/**
 * Emit an OpenTelemetry event: a log record named by `eventName`, the Logs API
 * model that replaces `Span.addEvent` (OTEP 4430).
 *
 * The name goes in the `eventName` field and the `event.name` attribute, as
 * autotel-web's `recordEvent` sends it, because collectors and backends are
 * split on which they read. It is also the body, so a backend's text search
 * finds the event by name (autotel-mcp's entity history searches that way).
 * Severity is INFO. `context` picks the span the record is correlated with;
 * without it, the active one.
 *
 * `logs.getLogger` returns a no-op logger when no `LoggerProvider` is
 * registered, so this costs nothing in an application that exports no logs.
 */
export function emitOtelEvent(
  name: string,
  attributes: Attributes,
  context?: Context,
): void {
  const record: LogRecord = {
    eventName: name,
    body: name,
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    attributes: { ...attributes, 'event.name': name },
  };
  // Set only when given: the SDK reads a present `context` key as the context,
  // even undefined, and the record would lose the active span.
  if (context) record.context = context;
  const warn = logExportWarn();
  if (!warnedLogsOff && warn && logExportMode() === 'off') {
    // Once per process: a dropped event otherwise looks like a sent one.
    warnedLogsOff = true;
    warn(
      `[autotel] Event "${name}" was not exported: log export is off ` +
        '(logs: false, AUTOTEL_LOGS=off or OTEL_LOGS_EXPORTER=none).',
    );
  }
  logs.getLogger('autotel').emit(record);
}

/** @internal Reset for testing */
export function resetOtelEventWarningForTesting(): void {
  warnedLogsOff = false;
}
