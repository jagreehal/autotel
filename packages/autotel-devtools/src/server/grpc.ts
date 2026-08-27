import {
  Server,
  ServerCredentials,
  status,
  type handleUnaryCall,
  type UntypedServiceImplementation,
} from '@grpc/grpc-js';
import {
  decodeOtlpLogsRequest,
  decodeOtlpMetricsRequest,
  decodeOtlpTraceRequest,
} from './otlp-proto';
import type { DevtoolsServer } from './server';
import type {
  OtlpLogsRequest,
  OtlpMetricsRequest,
  OtlpTraceRequest,
} from './otlp-types';

type Signal = 'traces' | 'logs' | 'metrics';
type OtlpPayload = OtlpTraceRequest | OtlpLogsRequest | OtlpMetricsRequest;
type Decoder = (bytes: Buffer) => OtlpPayload;

// SAFETY: each protobuf decoder uses the canonical OTLP service schema and
// returns its JSON-mapped request envelope; decoding validates the wire shape.
const decodeTrace = (bytes: Buffer) =>
  decodeOtlpTraceRequest(bytes) as OtlpTraceRequest;
// SAFETY: same schema-backed boundary as decodeTrace, for the logs service.
const decodeLogs = (bytes: Buffer) =>
  decodeOtlpLogsRequest(bytes) as OtlpLogsRequest;
// SAFETY: same schema-backed boundary as decodeTrace, for the metrics service.
const decodeMetrics = (bytes: Buffer) =>
  decodeOtlpMetricsRequest(bytes) as OtlpMetricsRequest;

const DEFINITIONS = [
  ['traces', 'trace', decodeTrace],
  ['logs', 'logs', decodeLogs],
  ['metrics', 'metrics', decodeMetrics],
] as const satisfies ReadonlyArray<readonly [Signal, string, Decoder]>;

export interface GrpcReceiver {
  port: number;
  address: string;
  close: () => Promise<void>;
}

function servicePath(namespace: string): string {
  return `/opentelemetry.proto.collector.${namespace}.v1.${namespace === 'trace' ? 'Trace' : namespace[0].toUpperCase() + namespace.slice(1)}Service/Export`;
}

export async function startOtlpGrpcReceiver(options: {
  devtools: DevtoolsServer;
  host?: string;
  port?: number;
  maxPortAttempts?: number;
}): Promise<GrpcReceiver> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 4317;
  const server = new Server();

  for (const [signal, namespace, decode] of DEFINITIONS) {
    const path = servicePath(namespace);
    const handler: handleUnaryCall<OtlpPayload, object> = (call, callback) => {
      try {
        options.devtools.ingestOtlp(signal, call.request);
        callback(null, {});
      } catch (error) {
        callback({
          code: status.INVALID_ARGUMENT,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    server.addService(
      {
        Export: {
          path,
          requestStream: false,
          responseStream: false,
          requestSerialize: (value: Buffer) => value,
          requestDeserialize: decode,
          responseSerialize: () => Buffer.alloc(0),
          responseDeserialize: () => ({}),
          originalName: 'Export',
        },
      },
      {
        Export: handler,
      } satisfies UntypedServiceImplementation,
    );
  }

  const attempts = Math.max(1, options.maxPortAttempts ?? 20);
  let lastError: unknown;
  for (let offset = 0; offset < attempts; offset++) {
    const port = requestedPort === 0 ? 0 : requestedPort + offset;
    try {
      const boundPort = await new Promise<number>((resolve, reject) => {
        server.bindAsync(
          `${host}:${port}`,
          ServerCredentials.createInsecure(),
          (error, actualPort) => (error ? reject(error) : resolve(actualPort)),
        );
      });
      return {
        port: boundPort,
        address: `${host}:${boundPort}`,
        close: () =>
          new Promise<void>((resolve) => server.tryShutdown(() => resolve())),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
