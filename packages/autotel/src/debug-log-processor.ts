/**
 * What `debug` adds when logs are on: the log records printed beside the span
 * output, one line each in `'pretty'` mode and raw with `true`.
 */
import {
  ConsoleLogRecordExporter,
  SimpleLogRecordProcessor,
  type LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { PrettyConsoleLogExporter } from './pretty-console-log-exporter';
import { RedactingLogRecordProcessor } from './posthog-logs';
import type { AttributeRedactorFn } from './attribute-redacting-processor';

/**
 * Redacted like any other destination when a redactor is configured: a
 * terminal is still output.
 */
export function debugLogProcessor(
  mode: true | 'pretty',
  redact: AttributeRedactorFn | null,
  isSensitiveKey?: (key: string) => boolean,
): LogRecordProcessor {
  const printer = new SimpleLogRecordProcessor({
    exporter:
      mode === 'pretty'
        ? new PrettyConsoleLogExporter()
        : new ConsoleLogRecordExporter(),
  });
  return redact
    ? new RedactingLogRecordProcessor(printer, redact, isSensitiveKey)
    : printer;
}
