import { describe, expect, it } from 'vitest';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { EventsOnlyLogRecordProcessor } from './events-only-log-processor';

describe('EventsOnlyLogRecordProcessor', () => {
  it('passes records with an eventName and drops plain log records', () => {
    const exporter = new InMemoryLogRecordExporter();
    const logger = new LoggerProvider({
      processors: [
        new EventsOnlyLogRecordProcessor(
          new SimpleLogRecordProcessor({ exporter }),
        ),
      ],
    }).getLogger('test');

    logger.emit({ eventName: 'checkout.started', body: 'checkout.started' });
    logger.emit({ body: 'a plain log line' });

    expect(exporter.getFinishedLogRecords().map((r) => r.body)).toEqual([
      'checkout.started',
    ]);
  });
});
