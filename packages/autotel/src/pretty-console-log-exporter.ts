/**
 * One line per log record, for `debug: 'pretty'`: severity, body, attributes,
 * and the trace it belongs to, so a record can be matched to the span tree
 * `PrettyConsoleExporter` prints beside it.
 *
 * ```text
 * log INFO  this is a log record body  log.type=custom  trace=6e21a3f2
 * ```
 */

import { SeverityNumber } from '@opentelemetry/api';
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';

import {
  ExportResultCode,
  paint,
  useColors,
  type AnsiColor,
  type ExportResult,
} from './console-format';

/** Attribute values longer than this are cut; a log line is not a dump. */
const MAX_VALUE_LENGTH = 80;

/** Enough of the trace id to find it in the span output above. */
const TRACE_ID_CHARS = 8;

/** The severity's name, from its text when set and its number otherwise. */
function severityOf(record: ReadableLogRecord): string {
  if (record.severityText) return record.severityText.toUpperCase();
  const number = record.severityNumber ?? SeverityNumber.UNSPECIFIED;
  if (number >= SeverityNumber.FATAL) return 'FATAL';
  if (number >= SeverityNumber.ERROR) return 'ERROR';
  if (number >= SeverityNumber.WARN) return 'WARN';
  if (number >= SeverityNumber.INFO) return 'INFO';
  if (number >= SeverityNumber.DEBUG) return 'DEBUG';
  if (number >= SeverityNumber.TRACE) return 'TRACE';
  return 'LOG';
}

function colorOf(severity: string): AnsiColor {
  if (severity === 'ERROR' || severity === 'FATAL') return 'red';
  if (severity === 'WARN') return 'yellow';
  if (severity === 'INFO') return 'cyan';
  return 'gray';
}

function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…`
    : text;
}

/** A body or attribute value as text: primitives bare, structures as JSON. */
function display(value: ReadableLogRecord['body']): string {
  if (value === undefined || value === null) return '';
  if (!(value instanceof Object)) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    // A cycle; the type name is still more use than nothing.
    return String(value);
  }
}

export interface PrettyConsoleLogExporterOptions {
  /** @default auto-detect TTY */
  colors?: boolean;
}

export class PrettyConsoleLogExporter implements LogRecordExporter {
  private readonly colors: boolean;

  constructor(options: PrettyConsoleLogExporterOptions = {}) {
    this.colors = useColors(options.colors);
  }

  export(
    records: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    try {
      for (const record of records) console.log(this.format(record));
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /** @internal Exposed for tests. */
  format(record: ReadableLogRecord): string {
    const severity = severityOf(record);
    const parts = [
      this.paint('dim', 'log'),
      this.paint(colorOf(severity), severity.padEnd(5)),
      display(record.body),
    ];
    const attributes = Object.entries(record.attributes)
      .map(([key, value]) => `${key}=${truncate(display(value))}`)
      .join(' ');
    if (attributes) parts.push(this.paint('gray', attributes));
    const traceId = record.spanContext?.traceId;
    if (traceId) {
      parts.push(
        this.paint('dim', `trace=${traceId.slice(0, TRACE_ID_CHARS)}`),
      );
    }
    return parts.join('  ');
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  private paint(color: AnsiColor, text: string): string {
    return paint(this.colors, color, text);
  }
}
