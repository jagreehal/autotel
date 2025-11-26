/**
 * Snowflake Subscriber Example
 *
 * Sends events events to Snowflake data warehouse.
 * This is a complete, production-ready implementation.
 *
 * Installation:
 * ```bash
 * pnpm add snowflake-sdk
 * ```
 *
 * Setup Snowflake table:
 * ```sql
 * CREATE TABLE events_events (
 *   event_id VARCHAR(36) PRIMARY KEY,
 *   event_type VARCHAR(50) NOT NULL,
 *   event_name VARCHAR(255) NOT NULL,
 *   attributes VARIANT,
 *   funnel VARCHAR(100),
 *   step VARCHAR(50),
 *   operation VARCHAR(100),
 *   outcome VARCHAR(50),
 *   value DECIMAL(18,2),
 *   timestamp TIMESTAMP_NTZ NOT NULL,
 *   created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
 * );
 *
 * CREATE INDEX idx_event_type ON events_events(event_type);
 * CREATE INDEX idx_event_name ON events_events(event_name);
 * CREATE INDEX idx_timestamp ON events_events(timestamp);
 * ```
 *
 * Usage:
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { SnowflakeSubscriber } from './adapter-snowflake';
 *
 * const events = new Events('app', {
 *   subscribers: [
 *     new SnowflakeSubscriber({
 *       account: 'xy12345.us-east-1',
 *       username: process.env.SNOWFLAKE_USER!,
 *       password: process.env.SNOWFLAKE_PASS!,
 *       database: 'ANALYTICS',
 *       schema: 'PUBLIC',
 *       warehouse: 'COMPUTE_WH',
 *       table: 'events_events'
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
import snowflake from 'snowflake-sdk';

export interface SnowflakeSubscriberConfig {
  /** Snowflake account (e.g., 'xy12345.us-east-1') */
  account: string;
  /** Username */
  username: string;
  /** Password */
  password: string;
  /** Database name */
  database: string;
  /** Schema name (default: 'PUBLIC') */
  schema?: string;
  /** Warehouse name (default: 'COMPUTE_WH') */
  warehouse?: string;
  /** Table name (default: 'events_events') */
  table?: string;
  /** Enable/disable subscriber */
  enabled?: boolean;
  /** Batch size (default: 100) */
  batchSize?: number;
  /** Flush interval in ms (default: 10000) */
  flushInterval?: number;
}

export class SnowflakeSubscriber extends EventSubscriber {
  readonly name = 'SnowflakeSubscriber';
  readonly version = '1.0.0';

  private connection: snowflake.Connection;
  private config: Required<SnowflakeSubscriberConfig>;
  private buffer: EventPayload[] = [];
  private flushIntervalHandle: NodeJS.Timeout | null = null;

  constructor(config: SnowflakeSubscriberConfig) {
    super();

    // Set defaults
    this.config = {
      schema: 'PUBLIC',
      warehouse: 'COMPUTE_WH',
      table: 'events_events',
      enabled: true,
      batchSize: 100,
      flushInterval: 10_000,
      ...config,
    };

    this.enabled = this.config.enabled;

    if (this.enabled) {
      this.initializeConnection();
      this.startFlushInterval();
    }
  }

  private initializeConnection(): void {
    this.connection = snowflake.createConnection({
      account: this.config.account,
      username: this.config.username,
      password: this.config.password,
      database: this.config.database,
      schema: this.config.schema,
      warehouse: this.config.warehouse,
    });

    // Connect asynchronously
    this.connection.connect((err) => {
      if (err) {
        console.error('[SnowflakeSubscriber] Failed to connect:', err);
        this.enabled = false;
      } else {
        console.log('[SnowflakeSubscriber] Connected successfully');
      }
    });
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
      console.error('[SnowflakeSubscriber] Failed to flush batch:', error);
      // Re-add to buffer for retry
      this.buffer.unshift(...batch);
    }
  }

  private async insertBatch(events: EventPayload[]): Promise<void> {
    const sql = `
      INSERT INTO ${this.config.table}
      (event_id, event_type, event_name, attributes, funnel, step, operation, outcome, value, timestamp)
      SELECT
        column1 as event_id,
        column2 as event_type,
        column3 as event_name,
        PARSE_JSON(column4) as attributes,
        column5 as funnel,
        column6 as step,
        column7 as operation,
        column8 as outcome,
        column9 as value,
        TO_TIMESTAMP_NTZ(column10) as timestamp
      FROM VALUES ${events.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
    `;

    const binds = events.flatMap((event) => [
      crypto.randomUUID(),
      event.type,
      event.name,
      JSON.stringify(event.attributes || {}),
      event.funnel || null,
      event.step || null,
      event.operation || null,
      event.outcome || null,
      event.value || null,
      event.timestamp,
    ]);

    return new Promise((resolve, reject) => {
      this.connection.execute({
        sqlText: sql,
        binds,
        complete: (err, _stmt, _rows) => {
          if (err) reject(err);
          else resolve();
        },
      });
    });
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

    // Close connection
    if (this.connection) {
      this.connection.destroy((err) => {
        if (err) {
          console.error('[SnowflakeSubscriber] Error closing connection:', err);
        }
      });
    }
  }
}
