/**
 * S3-specific instrumentation
 *
 * Provides semantic helpers for tracing S3 operations with proper OpenTelemetry
 * semantic conventions. Automatically sets `aws.s3.*` attributes.
 *
 * @example Basic usage with factory pattern
 * ```typescript
 * import { traceS3 } from 'autotel-aws/s3';
 * import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
 *
 * const s3 = new S3Client({});
 *
 * export const getFile = traceS3({
 *   operation: 'GetObject',
 *   bucket: 'my-bucket'
 * })(ctx => async (key: string) => {
 *   ctx.setAttribute('aws.s3.key', key);
 *   return await s3.send(new GetObjectCommand({ Bucket: 'my-bucket', Key: key }));
 * });
 *
 * // Usage: await getFile('path/to/file.txt');
 * ```
 *
 * @example Dynamic bucket
 * ```typescript
 * export const getObject = traceS3({
 *   operation: 'GetObject',
 * })(ctx => async (bucket: string, key: string) => {
 *   ctx.setAttribute('aws.s3.bucket', bucket);
 *   ctx.setAttribute('aws.s3.key', key);
 *   return await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
 * });
 *
 * // Usage: await getObject('my-bucket', 'file.txt');
 * ```
 */

import { trace, type TraceContext } from 'autotel';
import { buildS3Attributes } from '../attributes';

/**
 * S3 operation configuration
 */
export interface TraceS3Config {
  /**
   * S3 operation name (e.g., 'GetObject', 'PutObject', 'DeleteObject')
   * Used to generate the span name: `s3.{operation}`
   */
  operation: string;

  /**
   * Default bucket name for static configurations.
   * Can be overridden by setting `aws.s3.bucket` attribute in the handler.
   */
  bucket?: string;
}

/**
 * Trace S3 operations with semantic attributes
 *
 * Creates a traced function that automatically sets S3 semantic attributes
 * following OpenTelemetry conventions.
 *
 * @param config - S3 operation configuration
 * @returns A higher-order function that wraps your S3 operation with tracing
 *
 * @remarks
 * Semantic attributes set automatically:
 * - `aws.s3.bucket` - S3 bucket name (if provided in config)
 *
 * Additional attributes you should set in your handler:
 * - `aws.s3.key` - Object key
 * - `aws.s3.copy_source` - Source for copy operations
 *
 * @see https://opentelemetry.io/docs/specs/semconv/object-stores/s3/
 */
export function traceS3(config: TraceS3Config) {
  return function wrapper<TArgs extends unknown[], TReturn>(
    fn: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    // Use autotel's trace() which properly handles the factory pattern
    return trace(
      `s3.${config.operation}`,
      (ctx: TraceContext) =>
        async (...args: TArgs): Promise<TReturn> => {
          // Set S3 semantic attributes
          if (config.bucket) {
            ctx.setAttributes(buildS3Attributes({ bucket: config.bucket }));
          }

          // Get the user's handler and execute with forwarded arguments
          const handler = fn(ctx);
          return handler(...args);
        },
    );
  };
}
