import { beforeAll, describe, expect, it, vi } from 'vitest';
import { init } from './init';
import { createMemoryExporter } from './memory-exporter';
import { traceConsumer, traceProducer } from './messaging';
import { flush } from './shutdown';

interface KafkaRecord {
  offset: number;
  partition: number;
}

/** What `traceProducer` and `traceConsumer` export, read the way a backend would. */
describe('messaging spans', () => {
  const exporter = createMemoryExporter();

  beforeAll(() => {
    init({ service: 'messaging-spans-test', spanExporters: [exporter] });
  });

  it('reports the messages still waiting after this one as lag', async () => {
    const consume = traceConsumer<KafkaRecord>({
      system: 'kafka',
      destination: 'lag-events',
      lagMetrics: {
        getCurrentOffset: (msg) => msg.offset,
        // Offsets 0-9 written; the next write goes to 10.
        getEndOffset: () => 10,
      },
    })(() => async (_msg: KafkaRecord) => {});

    await consume({ offset: 7, partition: 0 });
    await consume({ offset: 9, partition: 0 });
    await flush();

    expect(
      exporter
        .findSpans('process lag-events')
        .map((span) => span.attributes['messaging.kafka.consumer_lag']),
    ).toEqual([2, 0]);
  });

  it('records partition and offset under the Kafka semconv names', async () => {
    const consume = traceConsumer<KafkaRecord>({
      system: 'kafka',
      destination: 'semconv-events',
      lagMetrics: {
        getCurrentOffset: (msg) => msg.offset,
        getPartition: (msg) => msg.partition,
      },
    })(() => async (_msg: KafkaRecord) => {});
    const publish = traceProducer({
      system: 'kafka',
      destination: 'semconv-events',
      partitionFrom: () => 2,
    })(() => async () => {});

    await publish();
    await consume({ offset: 42, partition: 2 });
    await flush();

    expect(
      exporter.findSpan('publish semconv-events')?.attributes,
    ).toMatchObject({ 'messaging.destination.partition.id': '2' });
    expect(
      exporter.findSpan('process semconv-events')?.attributes,
    ).toMatchObject({
      'messaging.destination.partition.id': '2',
      'messaging.kafka.offset': 42,
    });
  });

  it('records error.type when a handler throws before returning a promise', async () => {
    const onError = vi.fn();
    const consume = traceConsumer<KafkaRecord>({
      system: 'kafka',
      destination: 'sync-failing-events',
      onError,
    })(() => (_msg: KafkaRecord): Promise<void> => {
      throw new TypeError('unknown event type');
    });
    const publish = traceProducer({
      system: 'kafka',
      destination: 'sync-failing-events',
    })(() => (): Promise<void> => {
      throw new RangeError('message too large');
    });

    await expect(consume({ offset: 1, partition: 0 })).rejects.toThrow(
      TypeError,
    );
    expect(() => publish()).toThrow(RangeError);
    expect(onError).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.anything(),
    );
    await flush();

    expect(
      exporter.findSpan('process sync-failing-events')?.attributes[
        'error.type'
      ],
    ).toBe('TypeError');
    expect(
      exporter.findSpan('publish sync-failing-events')?.attributes[
        'error.type'
      ],
    ).toBe('RangeError');
  });

  it('records error.type when processing fails', async () => {
    const consume = traceConsumer<KafkaRecord>({
      system: 'kafka',
      destination: 'failing-events',
    })(() => async (_msg: KafkaRecord) => {
      throw new TypeError('unknown event type');
    });

    await expect(consume({ offset: 1, partition: 0 })).rejects.toThrow();
    await flush();

    expect(
      exporter.findSpan('process failing-events')?.attributes['error.type'],
    ).toBe('TypeError');
  });
});
