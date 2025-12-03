/**
 * Kinesis-specific instrumentation
 *
 * Provides semantic helpers for tracing Kinesis Data Streams operations with proper
 * OpenTelemetry messaging semantic conventions.
 *
 * @example Put record to stream
 * ```typescript
 * import { traceKinesis } from 'autotel-aws/kinesis';
 * import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';
 *
 * const kinesis = new KinesisClient({});
 *
 * export const putRecord = traceKinesis({
 *   operation: 'put',
 *   streamName: 'my-stream'
 * })(ctx => async (data: object, partitionKey: string) => {
 *   const result = await kinesis.send(new PutRecordCommand({
 *     StreamName: 'my-stream',
 *     Data: Buffer.from(JSON.stringify(data)),
 *     PartitionKey: partitionKey
 *   }));
 *
 *   ctx.setAttribute('aws.kinesis.shard_id', result.ShardId ?? '');
 *   ctx.setAttribute('aws.kinesis.sequence_number', result.SequenceNumber ?? '');
 *
 *   return result;
 * });
 *
 * // Usage: await putRecord({ event: 'click' }, 'user-123');
 * ```
 *
 * @example Get records from shard
 * ```typescript
 * export const getRecords = traceKinesis({
 *   operation: 'get',
 *   streamName: 'my-stream'
 * })(ctx => async (shardIterator: string, limit: number) => {
 *   const result = await kinesis.send(new GetRecordsCommand({
 *     ShardIterator: shardIterator,
 *     Limit: limit
 *   }));
 *
 *   ctx.setAttribute('messaging.batch.message_count', result.Records?.length ?? 0);
 *   return result;
 * });
 * ```
 */

import { trace, type TraceContext } from 'autotel';
import { context, propagation, SpanStatusCode } from '@opentelemetry/api';
import { buildKinesisAttributes } from '../attributes';
import { wrapSDKClient } from '../common/sdk-wrapper';

/**
 * Kinesis operation configuration
 */
export interface TraceKinesisConfig {
  /**
   * Kinesis operation type
   * - 'put' - PutRecord, PutRecords
   * - 'get' - GetRecords, GetShardIterator
   */
  operation: 'put' | 'get';

  /**
   * Kinesis stream name
   * Sets `messaging.destination.name` attribute.
   */
  streamName: string;

  /**
   * Shard ID (if known at configuration time)
   * Sets `aws.kinesis.shard_id` attribute.
   */
  shardId?: string;
}

/**
 * Trace Kinesis operations with semantic attributes
 *
 * Creates a traced function that automatically sets Kinesis messaging semantic attributes
 * following OpenTelemetry conventions.
 *
 * @param config - Kinesis operation configuration
 * @returns A higher-order function that wraps your Kinesis operation with tracing
 *
 * @remarks
 * Semantic attributes set automatically:
 * - `messaging.system` - 'aws_kinesis'
 * - `messaging.destination.name` - Stream name
 * - `messaging.operation` - 'put' or 'get'
 * - `aws.kinesis.shard_id` - Shard ID (if provided)
 *
 * Additional attributes you should set in your handler:
 * - `aws.kinesis.sequence_number` - Record sequence number
 * - `messaging.batch.message_count` - Number of records in batch
 *
 * @see https://opentelemetry.io/docs/specs/semconv/messaging/aws-kinesis/
 */
export function traceKinesis(config: TraceKinesisConfig) {
  return function wrapper<TArgs extends unknown[], TReturn>(
    fn: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    // Use autotel's trace() which properly handles the factory pattern
    return trace(
      `kinesis.${config.operation}`,
      (ctx: TraceContext) =>
        async (...args: TArgs): Promise<TReturn> => {
          // Set Kinesis semantic attributes
          ctx.setAttributes(
            buildKinesisAttributes({
              streamName: config.streamName,
              shardId: config.shardId,
              operation: config.operation,
            }),
          );

          // Get the user's handler and execute with forwarded arguments
          const handler = fn(ctx);
          return handler(...args);
        },
    );
  };
}

// ============================================================================
// Kinesis Producer - Puts records with automatic trace context injection
// ============================================================================

/**
 * Configuration for Kinesis Producer
 */
export interface KinesisProducerConfig {
  /**
   * Kinesis stream name or ARN
   */
  streamName: string;

  /**
   * Inject W3C Trace Context into record data
   * Enables distributed tracing across producer/consumer
   * @default true
   */
  injectTraceContext?: boolean;

  /**
   * Optional service name for tracing
   */
  service?: string;
}

/**
 * Record to put via Kinesis Producer
 */
export interface KinesisRecord {
  /**
   * Record data (will be serialized to JSON if object)
   */
  data: string | object;

  /**
   * Partition key for sharding
   */
  partitionKey: string;

  /**
   * Optional explicit hash key
   */
  explicitHashKey?: string;

  /**
   * Optional sequence number for ordering
   */
  sequenceNumberForOrdering?: string;
}

/**
 * Kinesis Producer with automatic trace context injection
 *
 * Wraps a Kinesis client to automatically:
 * - Create spans for put operations
 * - Inject W3C Trace Context into record data
 * - Set proper semantic attributes
 *
 * @example Basic usage
 * ```typescript
 * import { KinesisProducer } from 'autotel-aws/kinesis';
 * import { KinesisClient } from '@aws-sdk/client-kinesis';
 *
 * const kinesis = new KinesisClient({ region: 'us-east-1' });
 * const producer = new KinesisProducer(kinesis, {
 *   streamName: 'my-stream'
 * });
 *
 * // Put with automatic trace context
 * const result = await producer.putRecord({
 *   data: { event: 'click', userId: '123' },
 *   partitionKey: 'user-123'
 * });
 * console.log('Sequence:', result.sequenceNumber);
 * ```
 *
 * @example Batch put
 * ```typescript
 * const results = await producer.putRecords([
 *   { data: { event: 'click' }, partitionKey: 'user-1' },
 *   { data: { event: 'view' }, partitionKey: 'user-2' },
 *   { data: { event: 'scroll' }, partitionKey: 'user-3' }
 * ]);
 * console.log(`Put ${results.successful.length} records`);
 * ```
 */
export class KinesisProducer<
   
  TClient extends { send: (command: any) => Promise<any> } = any,
> {
  private client: TClient;
  private config: Required<Pick<KinesisProducerConfig, 'streamName'>> & KinesisProducerConfig;

  constructor(client: TClient, config: KinesisProducerConfig) {
    this.client = wrapSDKClient(client as any, config.service) as TClient;
    this.config = {
      injectTraceContext: true,
      ...config,
    };
  }

  /**
   * Inject trace context into record data
   */
  private injectContext(data: string | object): Buffer {
    let payload: object;

    if (typeof data === 'string') {
      try {
        payload = JSON.parse(data);
      } catch {
        // If not valid JSON, wrap in object
        payload = { _data: data };
      }
    } else {
      payload = data;
    }

    if (this.config.injectTraceContext) {
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);

      if (carrier.traceparent) {
        payload = {
          ...payload,
          _traceContext: {
            traceparent: carrier.traceparent,
            tracestate: carrier.tracestate,
            baggage: carrier.baggage,
          },
        };
      }
    }

    return Buffer.from(JSON.stringify(payload));
  }

  /**
   * Put a single record to the stream
   *
   * @param record - Record to put
   * @returns Promise with shard ID and sequence number
   */
  async putRecord(record: KinesisRecord): Promise<{
    shardId?: string;
    sequenceNumber?: string;
    encryptionType?: string;
  }> {
    return trace(`kinesis.put`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildKinesisAttributes({
          streamName: this.config.streamName,
          operation: 'put',
        }),
      );

      const input = {
        StreamName: this.config.streamName,
        Data: this.injectContext(record.data),
        PartitionKey: record.partitionKey,
        ...(record.explicitHashKey && { ExplicitHashKey: record.explicitHashKey }),
        ...(record.sequenceNumberForOrdering && {
          SequenceNumberForOrdering: record.sequenceNumberForOrdering,
        }),
      };

      try {
        const { PutRecordCommand } = await import('@aws-sdk/client-kinesis');
        const result = await this.client.send(new PutRecordCommand(input));

        if (result.ShardId) {
          ctx.setAttribute('aws.kinesis.shard_id', result.ShardId);
        }
        if (result.SequenceNumber) {
          ctx.setAttribute('aws.kinesis.sequence_number', result.SequenceNumber);
        }

        ctx.setStatus({ code: SpanStatusCode.OK });

        return {
          shardId: result.ShardId,
          sequenceNumber: result.SequenceNumber,
          encryptionType: result.EncryptionType,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Put failed',
        });
        throw error;
      }
    });
  }

  /**
   * Put multiple records in a batch
   *
   * @param records - Array of records to put (max 500)
   * @returns Promise with successful and failed record results
   */
  async putRecords(records: KinesisRecord[]): Promise<{
    successful: Array<{ shardId?: string; sequenceNumber?: string }>;
    failed: Array<{ errorCode?: string; errorMessage?: string }>;
    failedRecordCount: number;
  }> {
    return trace(`kinesis.putBatch`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildKinesisAttributes({
          streamName: this.config.streamName,
          operation: 'put',
        }),
      );
      ctx.setAttribute('messaging.batch.message_count', records.length);

      const entries = records.map((record) => ({
        Data: this.injectContext(record.data),
        PartitionKey: record.partitionKey,
        ...(record.explicitHashKey && { ExplicitHashKey: record.explicitHashKey }),
      }));

      try {
        const { PutRecordsCommand } = await import('@aws-sdk/client-kinesis');
        const result = await this.client.send(
          new PutRecordsCommand({
            StreamName: this.config.streamName,
            Records: entries,
          }),
        );

        const successful: Array<{ shardId?: string; sequenceNumber?: string }> = [];
        const failed: Array<{ errorCode?: string; errorMessage?: string }> = [];

        if (result.Records) {
          for (const r of result.Records) {
            const record = r as { ShardId?: string; SequenceNumber?: string; ErrorCode?: string; ErrorMessage?: string };
            if (record.ErrorCode) {
              failed.push({ errorCode: record.ErrorCode, errorMessage: record.ErrorMessage });
            } else {
              successful.push({ shardId: record.ShardId, sequenceNumber: record.SequenceNumber });
            }
          }
        }

        ctx.setAttribute('messaging.kinesis.successful_count', successful.length);
        ctx.setAttribute('messaging.kinesis.failed_count', result.FailedRecordCount || 0);

        if (result.FailedRecordCount && result.FailedRecordCount > 0) {
          ctx.setStatus({
            code: SpanStatusCode.ERROR,
            message: `${result.FailedRecordCount} records failed`,
          });
        } else {
          ctx.setStatus({ code: SpanStatusCode.OK });
        }

        return {
          successful,
          failed,
          failedRecordCount: result.FailedRecordCount || 0,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Batch put failed',
        });
        throw error;
      }
    });
  }
}

// ============================================================================
// Kinesis Consumer - Gets records with trace context extraction
// ============================================================================

/**
 * Configuration for Kinesis Consumer
 */
export interface KinesisConsumerConfig {
  /**
   * Kinesis stream name or ARN
   */
  streamName: string;

  /**
   * Extract W3C Trace Context from record data
   * Creates child spans linked to the producer
   * @default true
   */
  extractTraceContext?: boolean;

  /**
   * Optional service name for tracing
   */
  service?: string;
}

/**
 * Received Kinesis record with parsed data
 */
export interface ReceivedKinesisRecord {
  /**
   * Sequence number
   */
  sequenceNumber: string;

  /**
   * Approximate arrival timestamp
   */
  approximateArrivalTimestamp?: Date;

  /**
   * Parsed data (JSON parsed if possible)
   */
   
  data: any;

  /**
   * Raw data as string
   */
  rawData: string;

  /**
   * Partition key
   */
  partitionKey: string;

  /**
   * Encryption type
   */
  encryptionType?: string;

  /**
   * Original AWS SDK record object
   */
   
  raw: any;
}

/**
 * Record processor function type
 */
export type KinesisRecordProcessor = (
  record: ReceivedKinesisRecord,
  ctx: TraceContext,
) => Promise<void>;

/**
 * Kinesis Consumer with automatic trace context extraction
 *
 * Wraps a Kinesis client to automatically:
 * - Create spans for get operations
 * - Extract W3C Trace Context from record data
 * - Link consumer spans to producer spans
 *
 * @example Basic usage
 * ```typescript
 * import { KinesisConsumer } from 'autotel-aws/kinesis';
 * import { KinesisClient } from '@aws-sdk/client-kinesis';
 *
 * const kinesis = new KinesisClient({ region: 'us-east-1' });
 * const consumer = new KinesisConsumer(kinesis, {
 *   streamName: 'my-stream'
 * });
 *
 * // Get shard iterator first
 * const iterator = await consumer.getShardIterator('shardId-000000000000', 'LATEST');
 *
 * // Process records with automatic tracing
 * const { nextIterator, records } = await consumer.getRecords(iterator, 100);
 *
 * for (const record of records) {
 *   console.log('Record:', record.data);
 * }
 * ```
 *
 * @example With processor function
 * ```typescript
 * await consumer.processRecords(iterator, async (record, ctx) => {
 *   ctx.setAttribute('event.type', record.data.event);
 *   await handleEvent(record.data);
 * });
 * ```
 */
export class KinesisConsumer<
   
  TClient extends { send: (command: any) => Promise<any> } = any,
> {
  private client: TClient;
  private config: Required<Pick<KinesisConsumerConfig, 'streamName'>> & KinesisConsumerConfig;

  constructor(client: TClient, config: KinesisConsumerConfig) {
    this.client = wrapSDKClient(client as any, config.service) as TClient;
    this.config = {
      extractTraceContext: true,
      ...config,
    };
  }

  /**
   * Extract trace context from record data
   */
   
  private extractContext(data: any): Record<string, string> | undefined {
    if (!this.config.extractTraceContext || !data?._traceContext) {
      return undefined;
    }

    const tc = data._traceContext;
    const carrier: Record<string, string> = {};

    if (tc.traceparent) carrier.traceparent = tc.traceparent;
    if (tc.tracestate) carrier.tracestate = tc.tracestate;
    if (tc.baggage) carrier.baggage = tc.baggage;

    return Object.keys(carrier).length > 0 ? carrier : undefined;
  }

  /**
   * Parse raw record data
   */
   
  private parseRecord(record: any): ReceivedKinesisRecord {
    const rawData = record.Data ? Buffer.from(record.Data).toString('utf8') : '';
     
    let data: any;

    try {
      data = JSON.parse(rawData);
    } catch {
      data = rawData;
    }

    return {
      sequenceNumber: record.SequenceNumber || '',
      approximateArrivalTimestamp: record.ApproximateArrivalTimestamp,
      data,
      rawData,
      partitionKey: record.PartitionKey || '',
      encryptionType: record.EncryptionType,
      raw: record,
    };
  }

  /**
   * Get a shard iterator
   *
   * @param shardId - Shard ID
   * @param type - Iterator type
   * @param startingSequenceNumber - Starting sequence number (for AT_SEQUENCE_NUMBER, AFTER_SEQUENCE_NUMBER)
   * @param timestamp - Starting timestamp (for AT_TIMESTAMP)
   * @returns Shard iterator string
   */
  async getShardIterator(
    shardId: string,
    type: 'AT_SEQUENCE_NUMBER' | 'AFTER_SEQUENCE_NUMBER' | 'TRIM_HORIZON' | 'LATEST' | 'AT_TIMESTAMP',
    startingSequenceNumber?: string,
    timestamp?: Date,
  ): Promise<string> {
    return trace(`kinesis.getShardIterator`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildKinesisAttributes({
          streamName: this.config.streamName,
          shardId,
          operation: 'get',
        }),
      );

      try {
        const { GetShardIteratorCommand } = await import('@aws-sdk/client-kinesis');
        const result = await this.client.send(
          new GetShardIteratorCommand({
            StreamName: this.config.streamName,
            ShardId: shardId,
            ShardIteratorType: type,
            ...(startingSequenceNumber && { StartingSequenceNumber: startingSequenceNumber }),
            ...(timestamp && { Timestamp: timestamp }),
          }),
        );

        ctx.setStatus({ code: SpanStatusCode.OK });
        return result.ShardIterator || '';
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'GetShardIterator failed',
        });
        throw error;
      }
    });
  }

  /**
   * Get records from a shard iterator
   *
   * @param shardIterator - Shard iterator
   * @param limit - Maximum records to return (max 10000)
   * @returns Records and next shard iterator
   */
  async getRecords(
    shardIterator: string,
    limit?: number,
  ): Promise<{
    records: ReceivedKinesisRecord[];
    nextIterator?: string;
    millisBehindLatest?: number;
  }> {
    return trace(`kinesis.get`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildKinesisAttributes({
          streamName: this.config.streamName,
          operation: 'get',
        }),
      );

      try {
        const { GetRecordsCommand } = await import('@aws-sdk/client-kinesis');
        const result = await this.client.send(
          new GetRecordsCommand({
            ShardIterator: shardIterator,
            ...(limit && { Limit: limit }),
          }),
        );

         
        const records = (result.Records || []).map((r: any) => this.parseRecord(r));
        ctx.setAttribute('messaging.batch.message_count', records.length);

        if (result.MillisBehindLatest !== undefined) {
          ctx.setAttribute('aws.kinesis.millis_behind_latest', result.MillisBehindLatest);
        }

        ctx.setStatus({ code: SpanStatusCode.OK });

        return {
          records,
          nextIterator: result.NextShardIterator,
          millisBehindLatest: result.MillisBehindLatest,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'GetRecords failed',
        });
        throw error;
      }
    });
  }

  /**
   * Process records with automatic trace context extraction
   *
   * @param shardIterator - Shard iterator
   * @param processor - Function to process each record
   * @param limit - Maximum records to process
   * @returns Next shard iterator and count of processed records
   */
  async processRecords(
    shardIterator: string,
    processor: KinesisRecordProcessor,
    limit?: number,
  ): Promise<{ nextIterator?: string; processedCount: number }> {
    const { records, nextIterator } = await this.getRecords(shardIterator, limit);
    let processedCount = 0;

    for (const record of records) {
      // Extract trace context from record data
      const carrier = this.extractContext(record.data);

      // Create processing span, optionally linked to producer
      const processRecord = async () => {
        return trace(`kinesis.process`, async (ctx: TraceContext) => {
          ctx.setAttributes(
            buildKinesisAttributes({
              streamName: this.config.streamName,
              operation: 'get',
            }),
          );
          ctx.setAttribute('aws.kinesis.sequence_number', record.sequenceNumber);
          ctx.setAttribute('aws.kinesis.partition_key', record.partitionKey);

          try {
            await processor(record, ctx);
            processedCount++;
            ctx.setStatus({ code: SpanStatusCode.OK });
          } catch (error) {
            ctx.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : 'Processing failed',
            });
            throw error;
          }
        });
      };

      // Run with extracted context if available
      if (carrier) {
        const extractedContext = propagation.extract(context.active(), carrier);
        await context.with(extractedContext, processRecord);
      } else {
        await processRecord();
      }
    }

    return { nextIterator, processedCount };
  }

  /**
   * List shards for the stream
   *
   * @returns Array of shard IDs
   */
  async listShards(): Promise<string[]> {
    return trace(`kinesis.listShards`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildKinesisAttributes({
          streamName: this.config.streamName,
          operation: 'get',
        }),
      );

      try {
        const { ListShardsCommand } = await import('@aws-sdk/client-kinesis');
        const result = await this.client.send(
          new ListShardsCommand({
            StreamName: this.config.streamName,
          }),
        );

        const shardIds = result.Shards?.map((s: { ShardId?: string }) => s.ShardId || '') || [];
        ctx.setAttribute('aws.kinesis.shard_count', shardIds.length);
        ctx.setStatus({ code: SpanStatusCode.OK });

        return shardIds;
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'ListShards failed',
        });
        throw error;
      }
    });
  }
}
