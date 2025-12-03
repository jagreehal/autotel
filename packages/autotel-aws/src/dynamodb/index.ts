/**
 * DynamoDB-specific instrumentation
 *
 * Provides semantic helpers for tracing DynamoDB operations with proper OpenTelemetry
 * semantic conventions. Automatically sets `db.*` and `aws.dynamodb.*` attributes.
 *
 * @example Basic usage with factory pattern
 * ```typescript
 * import { traceDynamoDB } from 'autotel-aws/dynamodb';
 * import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
 *
 * const dynamodb = new DynamoDBClient({});
 *
 * export const getUser = traceDynamoDB({
 *   operation: 'GetItem',
 *   table: 'users'
 * })(ctx => async (userId: string) => {
 *   ctx.setAttribute('db.statement', 'GetItem WHERE id = :id');
 *   return await dynamodb.send(new GetItemCommand({
 *     TableName: 'users',
 *     Key: { id: { S: userId } }
 *   }));
 * });
 *
 * // Usage: await getUser('user-123');
 * ```
 *
 * @example Query with consumed capacity tracking
 * ```typescript
 * export const queryOrders = traceDynamoDB({
 *   operation: 'Query',
 *   table: 'orders'
 * })(ctx => async (customerId: string, limit: number) => {
 *   const result = await dynamodb.send(new QueryCommand({
 *     TableName: 'orders',
 *     KeyConditionExpression: 'customerId = :cid',
 *     ExpressionAttributeValues: { ':cid': { S: customerId } },
 *     Limit: limit,
 *     ReturnConsumedCapacity: 'TOTAL'
 *   }));
 *
 *   if (result.ConsumedCapacity?.CapacityUnits) {
 *     ctx.setAttribute('aws.dynamodb.consumed_capacity', result.ConsumedCapacity.CapacityUnits);
 *   }
 *
 *   return result.Items;
 * });
 * ```
 */

import { trace, type TraceContext } from 'autotel';
import { buildDynamoDBAttributes } from '../attributes';

/**
 * DynamoDB operation configuration
 */
export interface TraceDynamoDBConfig {
  /**
   * DynamoDB operation name (e.g., 'GetItem', 'PutItem', 'Query', 'Scan')
   * Used to generate the span name: `dynamodb.{operation}`
   */
  operation: string;

  /**
   * DynamoDB table name.
   * Sets `db.name` and `aws.dynamodb.table_names` attributes.
   */
  table: string;
}

/**
 * Trace DynamoDB operations with semantic attributes
 *
 * Creates a traced function that automatically sets DynamoDB semantic attributes
 * following OpenTelemetry database semantic conventions.
 *
 * @param config - DynamoDB operation configuration
 * @returns A higher-order function that wraps your DynamoDB operation with tracing
 *
 * @remarks
 * Semantic attributes set automatically:
 * - `db.system` - 'dynamodb'
 * - `db.operation` - The operation name (GetItem, PutItem, etc.)
 * - `db.name` - Table name
 * - `aws.dynamodb.table_names` - Array containing the table name
 *
 * Additional attributes you should set in your handler:
 * - `db.statement` - Query/operation description
 * - `aws.dynamodb.consumed_capacity` - Consumed capacity units
 * - `aws.dynamodb.index_name` - GSI/LSI name if applicable
 *
 * @see https://opentelemetry.io/docs/specs/semconv/database/dynamodb/
 */
export function traceDynamoDB(config: TraceDynamoDBConfig) {
  return function wrapper<TArgs extends unknown[], TReturn>(
    fn: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    // Use autotel's trace() which properly handles the factory pattern
    return trace(
      `dynamodb.${config.operation}`,
      (ctx: TraceContext) =>
        async (...args: TArgs): Promise<TReturn> => {
          // Set DynamoDB semantic attributes
          ctx.setAttributes(
            buildDynamoDBAttributes({
              tableName: config.table,
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
