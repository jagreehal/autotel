import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { safeRequire } from './node-require';
import type { StringRedactor } from './redact-values';

class RedactingLogRecordProcessor implements LogRecordProcessor {
  constructor(
    private wrapped: LogRecordProcessor,
    private redact: StringRedactor,
  ) {}

  onEmit(logRecord: any, context?: any): void {
    if (logRecord.body && typeof logRecord.body === 'string') {
      logRecord.body = this.redact(logRecord.body);
    }
    if (logRecord.attributes) {
      for (const [key, value] of Object.entries(logRecord.attributes)) {
        if (typeof value === 'string') {
          logRecord.attributes[key] = this.redact(value);
        } else if (Array.isArray(value)) {
          logRecord.attributes[key] = value.map((item: unknown) =>
            typeof item === 'string' ? this.redact(item) : item,
          );
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
    BatchLogRecordProcessor: new (exporter: unknown) => LogRecordProcessor;
  }>('@opentelemetry/sdk-logs');

  const exporterModule = safeRequire<{
    OTLPLogExporter: new (config: { url: string }) => unknown;
  }>('@opentelemetry/exporter-logs-otlp-http');

  if (!sdkLogs || !exporterModule) return [];

  const exporter = new exporterModule.OTLPLogExporter({ url });
  let processor: LogRecordProcessor = new sdkLogs.BatchLogRecordProcessor(
    exporter,
  );
  if (stringRedactor) {
    processor = new RedactingLogRecordProcessor(processor, stringRedactor);
  }

  return [processor];
}
