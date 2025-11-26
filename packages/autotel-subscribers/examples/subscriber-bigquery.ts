/**
 * BigQuery Subscriber Example
 *
 * Sends events events to Google BigQuery data warehouse.
 * This is a complete, production-ready implementation.
 *
 * Installation:
 * ```bash
 * pnpm add @google-cloud/bigquery
 * ```
 *
 * Setup BigQuery table:
 * ```sql
 * CREATE TABLE `project.dataset.events_events` (
 *   event_id STRING NOT NULL,
 *   event_type STRING NOT NULL,
 *   event_name STRING NOT NULL,
 *   attributes JSON,
 *   funnel STRING,
 *   step STRING,
 *   operation STRING,
 *   outcome STRING,
 *   value NUMERIC,
 *   timestamp TIMESTAMP NOT NULL,
 *   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
 * )
 * PARTITION BY DATE(timestamp)
 * CLUSTER BY event_type, event_name;
 * ```
 *
 * Setup Authentication:
 * ```bash
 * # Set environment variable
 * export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
 * ```
 *
 * Usage:
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { BigQuerySubscriber } from './adapter-bigquery';
 *
 * const events = new Events('app', {
 *   subscribers: [
 *     new BigQuerySubscriber({
 *       projectId: 'my-gcp-project',
 *       dataset: 'events',
 *       table: 'events'
 *     })
 *   ]
 * });
 *
 * events.trackEvent('order.completed', { orderId: 'ord_123', amount: 99.99 });
 * ```
 */

import {
  EventSubscriber,
  type EventPayload,
} from '../src/event-subscriber-base';
import { BigQuery } from '@google-cloud/bigquery';

export interface BigQuerySubscriberConfig {
  /** GCP Project ID */
  projectId: string;
  /** BigQuery dataset name */
  dataset: string;
  /** BigQuery table name */
  table: string;
  /** Service account key file path (optional, uses GOOGLE_APPLICATION_CREDENTIALS if not set) */
  keyFilename?: string;
  /** Enable/disable subscriber */
  enabled?: boolean;
  /** Batch size (default: 500) */
  batchSize?: number;
  /** Flush interval in ms (default: 10000) */
  flushInterval?: number;
}

export class BigQuerySubscriber extends EventSubscriber {
  readonly name = 'BigQuerySubscriber';
  readonly version = '1.0.0';

  private client: BigQuery;
  private tableRef: any;
  private config: Required<BigQuerySubscriberConfig>;
  private buffer: EventPayload[] = [];
  private flushIntervalHandle: NodeJS.Timeout | null = null;

  constructor(config: BigQuerySubscriberConfig) {
    super();

    // Set defaults
    this.config = {
      keyFilename: '',
      enabled: true,
      batchSize: 500,
      flushInterval: 10_000,
      ...config,
    };

    this.enabled = this.config.enabled;

    if (this.enabled) {
      this.initializeClient();
      this.startFlushInterval();
    }
  }

  private initializeClient(): void {
    try {
      const options: any = {
        projectId: this.config.projectId,
      };

      if (this.config.keyFilename) {
        options.keyFilename = this.config.keyFilename;
      }

      this.client = new BigQuery(options);

      const dataset = this.client.dataset(this.config.dataset);
      this.tableRef = dataset.table(this.config.table);

      console.log('[BigQuerySubscriber] Initialized successfully');
    } catch (error) {
      console.error('[BigQuerySubscriber] Failed to initialize:', error);
      this.enabled = false;
    }
  }

  private startFlushInterval(): void {
    this.flushIntervalHandle = setInterval(() => {
      void this.flushBuffer();
    }, this.config.flushInterval);
  }

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    this.buffer.push(payload);

    // Auto-flush at batch size
    if (this.buffer.length >= this.config.batchSize) {
      await this.flushBuffer();
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await this.insertBatch(batch);
    } catch (error) {
      console.error('[BigQuerySubscriber] Failed to flush batch:', error);
      // Re-add to buffer for retry
      this.buffer.unshift(...batch);
    }
  }

  private async insertBatch(events: EventPayload[]): Promise<void> {
    const rows = events.map((event) => ({
      event_id: crypto.randomUUID(),
      event_type: event.type,
      event_name: event.name,
      attributes: event.attributes || {},
      funnel: event.funnel || null,
      step: event.step || null,
      operation: event.operation || null,
      outcome: event.outcome || null,
      value: event.value || null,
      timestamp: event.timestamp,
    }));

    // Insert rows
    await this.tableRef.insert(rows, {
      // Skip invalid rows (don't fail entire batch)
      skipInvalidRows: false,
      // Don't ignore unknown values
      ignoreUnknownValues: false,
    });
  }

  protected handleError(error: Error, payload: EventPayload): void {
    console.error(
      `[BigQuerySubscriber] Failed to send ${payload.type}:`,
      error,
      {
        eventName: payload.name,
        attributes: payload.attributes,
      }
    );

    // BigQuery-specific error handling
    if (error.message.includes('quota')) {
      console.error('[BigQuerySubscriber] Quota exceeded - consider increasing batchSize or flushInterval');
    }

    if (error.message.includes('schema')) {
      console.error('[BigQuerySubscriber] Schema mismatch - check table schema');
    }
  }

  async shutdown(): Promise<void> {
    // Clear flush interval
    if (this.flushIntervalHandle) {
      clearInterval(this.flushIntervalHandle);
      this.flushIntervalHandle = null;
    }

    // Flush remaining events
    await this.flushBuffer();

    // Wait for pending requests
    await super.shutdown();

    console.log('[BigQuerySubscriber] Shutdown complete');
  }
}
