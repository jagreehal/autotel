import type { Context } from '@opentelemetry/api';
import type {
  LogRecordProcessor,
  ReadWriteLogRecord,
} from '@opentelemetry/sdk-logs';

/**
 * Passes on only OpenTelemetry events: records with an `eventName`
 * (`ctx.event`, `transition()` history, feature-flag evaluations).
 *
 * `init()` puts the endpoint's log exporter behind this when `logs` is unset,
 * so events export by default, as they do from autotel-web, while
 * application logs (pino, winston, console) stay opt-in with `logs: true`.
 */
export class EventsOnlyLogRecordProcessor implements LogRecordProcessor {
  constructor(private readonly wrapped: LogRecordProcessor) {}

  onEmit(logRecord: ReadWriteLogRecord, context?: Context): void {
    if (logRecord.eventName) this.wrapped.onEmit(logRecord, context);
  }

  forceFlush(): Promise<void> {
    return this.wrapped.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.wrapped.shutdown();
  }
}
