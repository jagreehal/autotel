import { afterEach, describe, expect, it } from 'vitest';
import { Client, credentials } from '@grpc/grpc-js';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { DevtoolsServer } from '../server';
import { startOtlpGrpcReceiver, type GrpcReceiver } from '../grpc';

let devtools: DevtoolsServer | undefined;
let receiver: GrpcReceiver | undefined;

afterEach(async () => {
  await receiver?.close();
  await devtools?.close();
  receiver = undefined;
  devtools = undefined;
});

describe('OTLP/gRPC receiver', () => {
  it('accepts canonical protobuf trace exports on the standard service path', async () => {
    devtools = new DevtoolsServer({
      port: 0,
      host: '127.0.0.1',
      retentionIntervalMs: 0,
    });
    receiver = await startOtlpGrpcReceiver({ devtools, port: 0 });

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const span = provider.getTracer('grpc-test').startSpan('grpc.operation', {
      kind: SpanKind.SERVER,
      attributes: { 'service.name': 'grpc-service' },
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    const bytes = Buffer.from(
      ProtobufTraceSerializer.serializeRequest(exporter.getFinishedSpans())!,
    );

    const client = new Client(receiver.address, credentials.createInsecure());
    await new Promise<void>((resolve, reject) => {
      client.makeUnaryRequest(
        '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
        (value: Buffer) => value,
        (value: Buffer) => value,
        bytes,
        (error) => (error ? reject(error) : resolve()),
      );
    });
    client.close();

    expect(devtools.getCurrentData().traces[0]?.rootSpan.name).toBe(
      'grpc.operation',
    );
  });
});
