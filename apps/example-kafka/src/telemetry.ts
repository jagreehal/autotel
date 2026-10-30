/**
 * autotel for the demo and the tests: spans in memory for the tables, and the
 * architecture snapshot of who sent and read each event.
 */
import { init } from 'autotel';
import { SimpleSpanProcessor } from 'autotel/processors';
import { createMemoryExporter } from 'autotel/testing';
import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';
import { SERVICE } from './kafka';

export const SNAPSHOT_FILE = '.autotel/snapshot.json';

export function startTelemetry() {
  const exporter = createMemoryExporter();
  const snapshot = new ArchitectureSnapshotSubscriber({ service: SERVICE });
  init({
    service: SERVICE,
    subscribers: [snapshot],
    // Tracked events carry the PRODUCER span they were published in, which
    // is what each CONSUMER span links to.
    events: { includeTraceContext: true },
    // The snapshot reads CONSUMER and workflow spans as they end.
    spanProcessors: [new SimpleSpanProcessor(exporter), snapshot.spanProcessor],
  });
  return { exporter, snapshot };
}
