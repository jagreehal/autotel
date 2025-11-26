/**
 * Databricks Subscriber Example
 *
 * Sends events events to Databricks Delta Lake via REST API.
 * This is a complete, production-ready implementation.
 *
 * Installation:
 * ```bash
 * # No additional dependencies required (uses fetch)
 * ```
 *
 * Setup Databricks table:
 * ```sql
 * CREATE TABLE events.events (
 *   event_id STRING NOT NULL,
 *   event_type STRING NOT NULL,
 *   event_name STRING NOT NULL,
 *   attributes MAP<STRING, STRING>,
 *   funnel STRING,
 *   step STRING,
 *   operation STRING,
 *   outcome STRING,
 *   value DECIMAL(18,2),
 *   timestamp TIMESTAMP NOT NULL,
 *   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
 * )
 * USING DELTA
 * PARTITIONED BY (DATE(timestamp))
 * TBLPROPERTIES (
 *   'delta.autoOptimize.optimizeWrite' = 'true',
 *   'delta.autoOptimize.autoCompact' = 'true'
 * );
 * ```
 *
 * Setup Authentication:
 * 1. Generate Personal Access Token in Databricks
 * 2. Get your workspace URL (e.g., 'https://dbc-1234567-890.cloud.databricks.com')
 * 3. Get your SQL warehouse ID
 *
 * Usage:
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { DatabricksSubscriber } from './adapter-databricks';
 *
 * const events = new Events('app', {
 *   subscribers: [
 *     new DatabricksSubscriber({
 *       host: 'https://dbc-1234567-890.cloud.databricks.com',
 *       token: process.env.DATABRICKS_TOKEN!,
 *       catalog: 'main',
 *       schema: 'events',
 *       table: 'events',
 *       warehouseId: 'abc123def456' // SQL warehouse ID
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

export interface DatabricksSubscriberConfig {
  /** Databricks workspace URL (e.g., 'https://dbc-1234567-890.cloud.databricks.com') */
  host: string;
  /** Personal Access Token */
  token: string;
  /** Unity Catalog name (default: 'main') */
  catalog?: string;
  /** Schema/database name */
  schema: string;
  /** Table name */
  table: string;
  /** SQL Warehouse ID (for SQL execution) */
  warehouseId: string;
  /** Enable/disable subscriber */
  enabled?: boolean;
  /** Batch size (default: 200) */
  batchSize?: number;
  /** Flush interval in ms (default: 10000) */
  flushInterval?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

interface SQLExecutionResponse {
  statement_id: string;
  status: {
    state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  };
}

export class DatabricksSubscriber extends EventSubscriber {
  readonly name = 'DatabricksSubscriber';
  readonly version = '1.0.0';

  private config: Required<DatabricksSubscriberConfig>;
  private buffer: EventPayload[] = [];
  private flushIntervalHandle: NodeJS.Timeout | null = null;

  constructor(config: DatabricksSubscriberConfig) {
    super();

    // Set defaults
    this.config = {
      catalog: 'main',
      enabled: true,
      batchSize: 200,
      flushInterval: 10_000,
      timeout: 30_000,
      ...config,
    };

    this.enabled = this.config.enabled;

    if (this.enabled) {
      this.startFlushInterval();
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
      console.error('[DatabricksSubscriber] Failed to flush batch:', error);
      // Re-add to buffer for retry
      this.buffer.unshift(...batch);
    }
  }

  private async insertBatch(events: EventPayload[]): Promise<void> {
    // Build VALUES clause
    const values = events
      .map((event) => {
        const eventId = crypto.randomUUID();
        const attributes = event.attributes
          ? Object.entries(event.attributes)
              .map(
                ([key, value]) =>
                  `'${this.escapeSql(key)}', '${this.escapeSql(String(value))}'`
              )
              .join(', ')
          : '';

        return `(
          '${eventId}',
          '${this.escapeSql(event.type)}',
          '${this.escapeSql(event.name)}',
          ${attributes ? `map(${attributes})` : 'map()'},
          ${event.funnel ? `'${this.escapeSql(event.funnel)}'` : 'NULL'},
          ${event.step ? `'${this.escapeSql(event.step)}'` : 'NULL'},
          ${event.operation ? `'${this.escapeSql(event.operation)}'` : 'NULL'},
          ${event.outcome ? `'${this.escapeSql(event.outcome)}'` : 'NULL'},
          ${event.value === undefined ? 'NULL' : event.value},
          CAST('${event.timestamp}' AS TIMESTAMP)
        )`;
      })
      .join(',\n');

    const sql = `
      INSERT INTO ${this.config.catalog}.${this.config.schema}.${this.config.table}
      (event_id, event_type, event_name, attributes, funnel, step, operation, outcome, value, timestamp)
      VALUES ${values}
    `;

    await this.executeSql(sql);
  }

  private async executeSql(sql: string): Promise<void> {
    // Execute SQL via Databricks SQL API
    const response = await fetch(
      `${this.config.host}/api/2.0/sql/statements`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          statement: sql,
          warehouse_id: this.config.warehouseId,
          wait_timeout: `${this.config.timeout / 1000}s`,
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Databricks API returned ${response.status}: ${error}`
      );
    }

    const result: SQLExecutionResponse = await response.json();

    // Check execution status
    if (result.status.state === 'FAILED') {
      throw new Error('SQL execution failed');
    }

    // For long-running queries, you might want to poll for completion
    // This example assumes synchronous execution (wait_timeout)
  }

  private escapeSql(value: string): string {
    // Escape single quotes for SQL
    return value.replaceAll('\'', "''");
  }

  protected handleError(error: Error, payload: EventPayload): void {
    console.error(
      `[DatabricksSubscriber] Failed to send ${payload.type}:`,
      error,
      {
        eventName: payload.name,
        attributes: payload.attributes,
      }
    );

    // Databricks-specific error handling
    if (error.message.includes('401')) {
      console.error(
        '[DatabricksSubscriber] Authentication failed - check your token'
      );
    }

    if (error.message.includes('warehouse')) {
      console.error(
        '[DatabricksSubscriber] SQL warehouse error - check warehouse ID and status'
      );
    }

    if (error.message.includes('timeout')) {
      console.error(
        '[DatabricksSubscriber] Timeout - consider increasing timeout or reducing batch size'
      );
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

    console.log('[DatabricksSubscriber] Shutdown complete');
  }
}
