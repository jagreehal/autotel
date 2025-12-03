/**
 * AWS SDK v3 instrumentation
 *
 * Provides multiple approaches for instrumenting AWS SDK v3 clients:
 *
 * @example Option A: Instrument existing client
 * ```typescript
 * import { instrumentSDK } from 'autotel-aws/sdk';
 * import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
 *
 * const s3 = instrumentSDK(new S3Client({ region: 'us-east-1' }));
 * await s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));
 * ```
 *
 * @example Option B: Create pre-instrumented client
 * ```typescript
 * import { createTracedClient } from 'autotel-aws/sdk';
 * import { S3Client } from '@aws-sdk/client-s3';
 *
 * const s3 = createTracedClient(S3Client, { region: 'us-east-1' });
 * ```
 *
 * @example Option C: Global auto-instrumentation
 * ```typescript
 * import { autoInstrumentAWS } from 'autotel-aws/sdk';
 *
 * // Call once at startup - all clients are automatically instrumented
 * autoInstrumentAWS();
 *
 * const s3 = new S3Client({ region: 'us-east-1' }); // Already instrumented!
 * ```
 */

export {
  instrumentSDK,
  createTracedClient,
  autoInstrumentAWS,
  disableAutoInstrumentAWS,
  isAutoInstrumentEnabled,
} from './auto-instrument';
export type { SDKInstrumentationConfig } from '../config';
