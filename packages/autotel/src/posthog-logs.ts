import type {
  LogRecordExporter,
  LogRecordProcessor,
  SdkLogRecord,
} from '@opentelemetry/sdk-logs';
import type { Context } from '@opentelemetry/api';
import type { AnyValue } from '@opentelemetry/api-logs';
import { safeRequire } from './node-require';
import { asString } from './values';
import type { StringRedactor } from './redact-values';

export class RedactingLogRecordProcessor implements LogRecordProcessor {
  constructor(
    private wrapped: LogRecordProcessor,
    private redact: StringRedactor,
  ) {}

  onEmit(logRecord: SdkLogRecord, context?: Context): void {
    const body = asString(logRecord.body);
    if (body) {
      logRecord.body = this.redact(body);
    }
    if (logRecord.attributes) {
      for (const [key, value] of Object.entries(logRecord.attributes)) {
        const text = asString(value);
        if (text !== undefined) {
          logRecord.attributes[key] = this.redact(text);
        } else if (Array.isArray(value)) {
          logRecord.attributes[key] = value.map((item: AnyValue) => {
            const entry = asString(item);
            return entry === undefined ? item : this.redact(entry);
          });
        }
      }
    }
    this.wrapped.onEmit(logRecord, context);
  }

  shutdown(): Promise<void> {
    return this.wrapped.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.wrapped.forceFlush();
  }
}

export interface PostHogConfig {
  /** OTLP logs endpoint URL (e.g., https://us.i.posthog.com/i/v1/logs?token=phc_xxx) */
  url: string;
}

/**
 * Build log record processors for PostHog OTLP logs integration.
 *
 * Resolution order:
 * 1. config.url if provided
 * 2. POSTHOG_LOGS_URL env var
 * 3. Empty array (disabled)
 */
export function buildPostHogLogProcessors(
  config: PostHogConfig | undefined,
  stringRedactor?: StringRedactor | null,
): LogRecordProcessor[] {
  const url = config?.url || process.env.POSTHOG_LOGS_URL;
  if (!url) return [];

  const sdkLogs = safeRequire<{
    BatchLogRecordProcessor: new (options: {
      exporter: unknown;
    }) => LogRecordProcessor;
  }>('@opentelemetry/sdk-logs');

  const exporterModule = safeRequire<{
    OTLPLogExporter: new (config: { url: string }) => LogRecordExporter;
  }>('@opentelemetry/exporter-logs-otlp-http');

  if (!sdkLogs || !exporterModule) return [];

  const exporter = new exporterModule.OTLPLogExporter({ url });
  let processor: LogRecordProcessor = new sdkLogs.BatchLogRecordProcessor({
    exporter,
  });
  if (stringRedactor) {
    processor = new RedactingLogRecordProcessor(processor, stringRedactor);
  }

  return [processor];
}
