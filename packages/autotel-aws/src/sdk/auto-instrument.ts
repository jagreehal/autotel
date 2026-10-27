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

import { readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
// Type-only import from optional peer dependency
// @ts-expect-error - Optional peer dependency, may not be installed
import type { Client, Command } from '@aws-sdk/smithy-client';
import { wrapSDKClient } from '../common/sdk-wrapper';
import type { SDKInstrumentationConfig } from '../config';

// Synchronous require that works in both the ESM and CJS builds. See
// packages/autotel/src/node-require.ts for the __filename / import.meta.url
// fallback. Built on first use so importing this module stays side-effect-free.
declare const __filename: string | undefined;
function ownRequire(): NodeJS.Require {
  return createRequire(
    /* oxlint-disable-next-line anti-slop/no-runtime-typeof -- Probing which module format this build is running as. `__filename` is bound only in the CJS output; the presence of the binding is the fact being read. */
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
}
function loadModule(id: string): any {
  return ownRequire()(id);
}

// Symbol to mark clients as instrumented (prevents double-wrapping)
const INSTRUMENTED_SYMBOL = Symbol.for('autotel-aws.instrumented');

// Track whether global auto-instrumentation is active
let globalAutoInstrumentEnabled = false;

// Each patched base Client class and its original send, for restoration
const patchedClients = new Map<any, (...args: unknown[]) => Promise<unknown>>();

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
 * - `rpc.system.name` - 'aws-api'
 * - `rpc.service` - AWS service name (e.g., 'S3', 'DynamoDB')
 * - `rpc.method` - Operation name (e.g., 'GetObject', 'PutItem')
 * - `aws.request_id` - AWS request ID from response
 * - `http.response.status_code` - HTTP status code
 *
 * @see https://opentelemetry.io/docs/specs/semconv/cloud-providers/aws-sdk/
 */
export function instrumentSDK<
  T extends Client<unknown, unknown, unknown, unknown>,
>(client: T, config?: SDKInstrumentationConfig): T {
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
 * - Finds the SDK's base Client (`@smithy/core/client` in current SDKs,
 *   `@smithy/smithy-client` or `@aws-sdk/smithy-client` in older ones) beside
 *   each installed `@aws-sdk/client-*`, so isolated installs (pnpm) work
 *
 * @throws Error if AWS SDK is not installed
 */
export function autoInstrumentAWS(config?: SDKInstrumentationConfig): void {
  // Idempotency check
  if (globalAutoInstrumentEnabled) {
    return;
  }

  const clients = findSmithyClients();
  if (clients.size === 0) {
    console.warn(
      '[autotel-aws] autoInstrumentAWS() could not find the AWS SDK base Client (@smithy/core/client, @smithy/smithy-client or @aws-sdk/smithy-client). ' +
        'Install an AWS SDK v3 client package (e.g., @aws-sdk/client-s3) or use instrumentSDK() directly.',
    );
    return;
  }
  for (const SmithyClient of clients) _patchClientClass(SmithyClient, config);
}

const SMITHY_CLIENT_IDS = [
  '@smithy/core/client',
  '@smithy/smithy-client',
  '@aws-sdk/smithy-client',
];
const AWS_CLIENT_FILE = /^(.*[\\/]@aws-sdk[\\/]client-[^\\/]+)[\\/]/;

/**
 * Every distinct SDK base Client class this process can reach. Smithy is a
 * dependency of each AWS client, so under isolated installs (pnpm) it resolves
 * from beside a client rather than from the app or this package. The lookup
 * starts at the AWS clients the app has already loaded, then this package,
 * then the nearest `node_modules/@aws-sdk/client-*` Node resolves from the
 * app's entry script. Clients that pin different Smithy versions each get
 * their own class, and each is patched.
 *
 * A bundle that inlines the SDK keeps no node_modules to search; use
 * instrumentSDK() there.
 */
function findSmithyClients(): Set<any> {
  const loaded = new Set<string>();
  for (const file of Object.keys(ownRequire().cache)) {
    const match = AWS_CLIENT_FILE.exec(file);
    if (match) loaded.add(path.join(match[1], 'package.json'));
  }
  const installed = new Set<string>();
  const entry = process.argv[1];
  let searchPaths: string[] = [];
  try {
    if (entry) {
      searchPaths =
        createRequire(realpathSync(entry)).resolve.paths('@aws-sdk/x') ?? [];
    }
  } catch {
    // An entry Node did not load from disk (a REPL, `node -e`).
  }
  // The nearest node_modules holding AWS clients, as Node resolves them. A
  // client counts only when its real path stays inside a node_modules Node
  // searches from the entry (pnpm's store at the workspace root qualifies).
  const inSearchPath = (file: string) =>
    searchPaths.some((dir) => file.startsWith(dir + path.sep));
  for (const dir of searchPaths) {
    let names: string[];
    try {
      names = readdirSync(path.join(dir, '@aws-sdk'));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith('client-')) continue;
      // Follow pnpm's symlink: Smithy sits beside the real package, and a
      // require built on the link's path searches beside the link instead.
      try {
        const real = realpathSync(path.join(dir, '@aws-sdk', name));
        if (inSearchPath(real)) installed.add(path.join(real, 'package.json'));
      } catch {
        // A dangling link; skip it.
      }
    }
    break;
  }

  const found = new Set<any>();
  const loaders = [
    ...[...loaded].map((base) => createRequire(base)),
    loadModule,
    ...[...installed].map((base) => createRequire(base)),
  ];
  for (const load of loaders) {
    for (const id of SMITHY_CLIENT_IDS) {
      try {
        const Client = load(id).Client;
        if (Client?.prototype?.send) {
          found.add(Client);
          break;
        }
      } catch {
        // Not reachable from here; try the next.
      }
    }
  }
  return found;
}

/** Patch `SmithyClient.prototype.send` to trace. Exported for tests. */
export function _patchClientClass(
  SmithyClient: any,
  config?: SDKInstrumentationConfig,
): void {
  if (patchedClients.has(SmithyClient)) return;
  const originalSend = SmithyClient.prototype.send;
  patchedClients.set(SmithyClient, originalSend);
  globalAutoInstrumentEnabled = true;

  SmithyClient.prototype.send = function patchedSend(
    this: Client<unknown, unknown, unknown, unknown>,
    command: Command<unknown, unknown, unknown, unknown, unknown>,
    ...args: unknown[]
  ): Promise<unknown> {
    // Skip if this specific client is already instrumented (via instrumentSDK)
    if (isInstrumented(this)) {
      return originalSend.call(this, command, ...args);
    }
    // Trace through the original send. This client's own `send` is this
    // patched function, so the wrapper calls the original instead.
    const wrappedClient = wrapSDKClient(this, config?.service, (cmd, ...rest) =>
      originalSend.call(this, cmd, ...rest),
    );
    return (wrappedClient as any).send(command, ...args);
  };
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
  for (const [SmithyClient, originalSend] of patchedClients) {
    SmithyClient.prototype.send = originalSend;
  }
  patchedClients.clear();
  globalAutoInstrumentEnabled = false;
}

/**
 * Check if global auto-instrumentation is enabled
 */
export function isAutoInstrumentEnabled(): boolean {
  return globalAutoInstrumentEnabled;
}
