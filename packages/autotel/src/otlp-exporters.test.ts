import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTraceExporter } from './otlp-exporters';

/** The slice of `@grpc/grpc-js` the gRPC test uses; not a dependency of ours. */
interface GrpcJs {
  Server: new () => {
    addService(service: object, handlers: object): void;
    bindAsync(
      address: string,
      credentials: unknown,
      callback: (error: Error | null, port: number) => void,
    ): void;
    forceShutdown(): void;
  };
  ServerCredentials: { createInsecure(): unknown };
  status: { UNAUTHENTICATED: number };
}

describe('rejected exports', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns once when the backend rejects the key', async () => {
    const server = createServer((_, res) => {
      res
        .writeHead(403, 'Forbidden')
        .end('{"errors":["API key is missing or invalid"]}');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`;
    const url = `${endpoint.replace('http://', 'http://user:secret@')}?api-key=secret`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const exporter = createTraceExporter('http', { url });
    for (let i = 0; i < 2; i++) {
      const result = await new Promise((resolve) =>
        exporter.export([], resolve),
      );
      expect(result).toMatchObject({ code: 1 });
    }
    server.close();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).not.toContain('secret');
    expect(warn.mock.calls[0]?.[0]).toBe(
      `[autotel] traces export to ${endpoint} rejected: 403 Forbidden ({"errors":["API key is missing or invalid"]}). Telemetry is being dropped.`,
    );
  });

  it('warns once when a gRPC backend rejects the key', async () => {
    // grpc-js is the gRPC exporter's dependency, not autotel's.
    const require = createRequire(import.meta.url);
    const grpc = createRequire(
      require.resolve('@opentelemetry/otlp-grpc-exporter-base', {
        paths: [require.resolve('@opentelemetry/exporter-trace-otlp-grpc')],
      }),
    )('@grpc/grpc-js') as GrpcJs;
    const passthrough = (b: Buffer) => b;
    const server = new grpc.Server();
    server.addService(
      {
        Export: {
          path: '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
          requestStream: false,
          responseStream: false,
          requestSerialize: passthrough,
          requestDeserialize: passthrough,
          responseSerialize: passthrough,
          responseDeserialize: passthrough,
        },
      },
      {
        Export: (
          _call: unknown,
          callback: (error: { code: number; details: string }) => void,
        ) =>
          callback({
            code: grpc.status.UNAUTHENTICATED,
            details: 'invalid API key',
          }),
      },
    );
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        grpc.ServerCredentials.createInsecure(),
        (error, bound) => (error ? reject(error) : resolve(bound)),
      ),
    );
    const url = `http://127.0.0.1:${port}`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const exporter = createTraceExporter('grpc', { url });
    for (let i = 0; i < 2; i++) {
      const result = await new Promise((resolve) =>
        exporter.export([], resolve),
      );
      expect(result).toMatchObject({ code: 1 });
    }
    await exporter.shutdown();
    server.forceShutdown();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(
      `[autotel] traces export to ${url} rejected: 16 UNAUTHENTICATED: invalid API key. Telemetry is being dropped.`,
    );
  });
});
