/**
 * AWS SDK v3 auto-instrumentation
 *
 * Provides multiple approaches for instrumenting AWS SDK v3 clients:
 * 1. `instrumentSDK()` - Wrap an existing client instance
 * 2. `createTracedClient()` - Create a pre-instrumented client
 * 3. `autoInstrumentAWS()` - Globally patch all AWS SDK clients
 *
 * @example Basic instrumentation
 * ```typescript
 * import { instrumentSDK } from 'autotel-aws/sdk';
 * import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
 *
 * const s3 = instrumentSDK(new S3Client({ region: 'us-east-1' }));
 *
 * // All send() calls are now traced
 * await s3.send(new PutObjectCommand({ Bucket: 'my-bucket', Key: 'file.txt' }));
 * ```
 */

// Type-only import from optional peer dependency
// @ts-expect-error - Optional peer dependency, may not be installed
import type { Client, Command } from '@aws-sdk/smithy-client';
import { wrapSDKClient } from '../common/sdk-wrapper';
import type { SDKInstrumentationConfig } from '../config';

// Symbol to mark clients as instrumented (prevents double-wrapping)
const INSTRUMENTED_SYMBOL = Symbol.for('autotel-aws.instrumented');

// Track whether global auto-instrumentation is active
let globalAutoInstrumentEnabled = false;

// Store original send method for restoration
let originalSmithyClientSend: ((...args: unknown[]) => Promise<unknown>) | null = null;

/**
 * Check if a client is already instrumented
 */
function isInstrumented(client: unknown): boolean {
  return (
    typeof client === 'object' &&
    client !== null &&
    (client as Record<symbol, boolean>)[INSTRUMENTED_SYMBOL] === true
  );
}

/**
 * Mark a client as instrumented
 */
function markAsInstrumented<T>(client: T): T {
  (client as Record<symbol, boolean>)[INSTRUMENTED_SYMBOL] = true;
  return client;
}

/**
 * Instrument an existing AWS SDK v3 client
 *
 * Wraps the client's `send()` method to automatically create spans
 * for all AWS API calls with proper semantic attributes.
 *
 * @param client - An AWS SDK v3 client instance
 * @param config - Optional instrumentation configuration
 * @returns The instrumented client (same instance, modified)
 *
 * @example Basic usage
 * ```typescript
 * import { instrumentSDK } from 'autotel-aws/sdk';
 * import { S3Client } from '@aws-sdk/client-s3';
 *
 * const s3 = instrumentSDK(new S3Client({ region: 'us-east-1' }));
 * ```
 *
 * @example With configuration
 * ```typescript
 * const s3 = instrumentSDK(new S3Client({}), {
 *   service: 's3',
 *   captureRequest: true,
 *   captureResponse: true
 * });
 * ```
 *
 * @remarks
 * Semantic attributes set automatically:
 * - `rpc.system` - 'aws-api'
 * - `rpc.service` - AWS service name (e.g., 'S3', 'DynamoDB')
 * - `rpc.method` - Operation name (e.g., 'GetObject', 'PutItem')
 * - `aws.request_id` - AWS request ID from response
 * - `http.status_code` - HTTP status code
 *
 * @see https://opentelemetry.io/docs/specs/semconv/cloud-providers/aws-sdk/
 */
export function instrumentSDK<T extends Client<unknown, unknown, unknown, unknown>>(
  client: T,
  config?: SDKInstrumentationConfig,
): T {
  // Prevent double-instrumentation
  if (isInstrumented(client)) {
    return client;
  }

  const wrappedClient = wrapSDKClient(client, config?.service);
  return markAsInstrumented(wrappedClient);
}

/**
 * Create a pre-instrumented AWS SDK v3 client
 *
 * Convenience factory that creates and instruments a client in one call.
 *
 * @param ClientClass - The AWS SDK client class constructor
 * @param config - Client configuration merged with instrumentation config
 * @returns A new instrumented client instance
 *
 * @example
 * ```typescript
 * import { createTracedClient } from 'autotel-aws/sdk';
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
 *
 * // Create instrumented clients
 * const s3 = createTracedClient(S3Client, { region: 'us-east-1' });
 * const dynamodb = createTracedClient(DynamoDBClient, {
 *   region: 'us-east-1',
 *   captureRequest: true
 * });
 * ```
 */
export function createTracedClient<
   
  T extends new (...args: any[]) => Client<unknown, unknown, unknown, unknown>,
>(
  ClientClass: T,
  config?: SDKInstrumentationConfig & ConstructorParameters<T>[0],
): InstanceType<T> {
   
  const client = new ClientClass(config as any);
  return instrumentSDK(client, config) as InstanceType<T>;
}

/**
 * Auto-instrument all AWS SDK v3 clients globally
 *
 * Patches the AWS SDK's base Client class to automatically instrument
 * all client instances created after this call. This is the most convenient
 * approach but requires the AWS SDK to be installed.
 *
 * Call this once at application startup, before creating any clients.
 *
 * @param config - Optional default instrumentation configuration
 *
 * @example Basic usage
 * ```typescript
 * import { autoInstrumentAWS } from 'autotel-aws/sdk';
 *
 * // Call once at startup
 * autoInstrumentAWS();
 *
 * // All subsequent clients are automatically instrumented
 * const s3 = new S3Client({ region: 'us-east-1' });
 * const dynamodb = new DynamoDBClient({ region: 'us-east-1' });
 *
 * // Both are traced automatically
 * await s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));
 * await dynamodb.send(new GetItemCommand({ TableName: 't', Key: {} }));
 * ```
 *
 * @example With default configuration
 * ```typescript
 * autoInstrumentAWS({
 *   captureRequest: false,
 *   captureResponse: false
 * });
 * ```
 *
 * @remarks
 * - This function is idempotent - calling it multiple times has no effect
 * - Clients created before calling this function are NOT instrumented
 * - Use `instrumentSDK()` for clients created before auto-instrumentation
 * - Requires `@aws-sdk/smithy-client` to be installed (peer dependency)
 *
 * @throws Error if AWS SDK is not installed
 */
export function autoInstrumentAWS(config?: SDKInstrumentationConfig): void {
  // Idempotency check
  if (globalAutoInstrumentEnabled) {
    return;
  }

  // Try to get the smithy-client module
   
  let SmithyClient: any;
  try {
    // Dynamic require to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SmithyClient = require('@aws-sdk/smithy-client').Client;
  } catch {
    // Try the core package (newer SDK versions)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SmithyClient = require('@smithy/smithy-client').Client;
    } catch {
      console.warn(
        '[autotel-aws] autoInstrumentAWS() requires @aws-sdk/smithy-client or @smithy/smithy-client. ' +
          'Install an AWS SDK v3 client package (e.g., @aws-sdk/client-s3) or use instrumentSDK() directly.',
      );
      return;
    }
  }

  // Store original send for potential restoration
  originalSmithyClientSend = SmithyClient.prototype.send;

  // Patch the prototype's send method
  const originalSend = SmithyClient.prototype.send;

  SmithyClient.prototype.send = function patchedSend(
    this: Client<unknown, unknown, unknown, unknown>,
    command: Command<unknown, unknown, unknown, unknown, unknown>,
    ...args: unknown[]
  ): Promise<unknown> {
    // Skip if this specific client is already instrumented (via instrumentSDK)
    if (isInstrumented(this)) {
      return originalSend.call(this, command, ...args);
    }

    // Create a one-time wrapped client for this call
    // This is less efficient than pre-wrapping, but ensures all calls are traced
    const wrappedClient = wrapSDKClient(this as Client<unknown, unknown, unknown, unknown>, config?.service);
     
    return (wrappedClient as any).send(command, ...args);
  };

  globalAutoInstrumentEnabled = true;
}

/**
 * Disable global auto-instrumentation
 *
 * Restores the original AWS SDK behavior. Useful for testing or
 * when you need to disable instrumentation temporarily.
 *
 * @example
 * ```typescript
 * import { autoInstrumentAWS, disableAutoInstrumentAWS } from 'autotel-aws/sdk';
 *
 * autoInstrumentAWS();
 * // ... use instrumented clients ...
 *
 * disableAutoInstrumentAWS();
 * // Subsequent operations are not traced
 * ```
 */
export function disableAutoInstrumentAWS(): void {
  if (!globalAutoInstrumentEnabled || !originalSmithyClientSend) {
    return;
  }

   
  let SmithyClient: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SmithyClient = require('@aws-sdk/smithy-client').Client;
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SmithyClient = require('@smithy/smithy-client').Client;
    } catch {
      return;
    }
  }

  // Restore original send
  SmithyClient.prototype.send = originalSmithyClientSend;
  originalSmithyClientSend = null;
  globalAutoInstrumentEnabled = false;
}

/**
 * Check if global auto-instrumentation is enabled
 */
export function isAutoInstrumentEnabled(): boolean {
  return globalAutoInstrumentEnabled;
}
