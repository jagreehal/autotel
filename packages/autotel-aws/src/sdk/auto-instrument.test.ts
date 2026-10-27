import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { createTraceCollector, type TraceCollector } from 'autotel/testing';
import {
  GetObjectCommand as S3GetObject,
  S3Client as RealS3,
} from '@aws-sdk/client-s3';
import {
  _patchClientClass,
  autoInstrumentAWS,
  disableAutoInstrumentAWS,
  isAutoInstrumentEnabled,
} from './auto-instrument';

// Stands in for the SDK's base Client: subclasses inherit `send`.
class FakeClient {
  calls: unknown[][] = [];
  async send(...args: unknown[]) {
    this.calls.push(args);
    return { $metadata: { httpStatusCode: 200, requestId: 'req-1' } };
  }
}
class S3Client extends FakeClient {}
class GetObjectCommand {
  input = { Bucket: 'b', Key: 'k' };
}

describe('autoInstrumentAWS', () => {
  let collector: TraceCollector;
  const originalSend = FakeClient.prototype.send;

  beforeEach(() => {
    collector = createTraceCollector();
  });

  afterEach(() => {
    disableAutoInstrumentAWS();
  });

  it('traces each send once and forwards every argument', async () => {
    _patchClientClass(FakeClient);
    const client = new S3Client();
    const options = { abortSignal: 'signal' };

    const response = await client.send(new GetObjectCommand(), options);

    expect(response.$metadata.requestId).toBe('req-1');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0][1]).toBe(options);
    const spans = collector.getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('aws.S3.GetObject');
  });

  it('restores the original send when disabled', () => {
    _patchClientClass(FakeClient);
    expect(isAutoInstrumentEnabled()).toBe(true);
    disableAutoInstrumentAWS();
    expect(FakeClient.prototype.send).toBe(originalSend);
    expect(isAutoInstrumentEnabled()).toBe(false);
  });
});

// Under pnpm's isolated installs, Smithy is reachable only from beside each
// AWS client, not from this package or the working directory. Discovery has to
// find it there, so this runs the real client through autoInstrumentAWS().
describe('autoInstrumentAWS() with an installed AWS client', () => {
  let collector: TraceCollector;
  // pnpm's bin shims set NODE_PATH to its hidden hoist folder, from which
  // Smithy resolves anywhere. A plain `node` start has none, so drop it.
  const nodePath = process.env.NODE_PATH;
  // SAFETY: Node's own CJS loader internals; `_initPaths` re-reads NODE_PATH
  // and `_pathCache` holds earlier resolutions made under it.
  const loader = Module as unknown as {
    _initPaths(): void;
    _pathCache: Record<string, string>;
  };
  const isolate = () => {
    loader._initPaths();
    for (const key of Object.keys(loader._pathCache)) {
      delete loader._pathCache[key];
    }
  };

  beforeAll(() => {
    delete process.env.NODE_PATH;
    isolate();
    // The condition under test: Smithy is not reachable from the package.
    expect(() =>
      createRequire(path.join(process.cwd(), 'noop.js')).resolve(
        '@smithy/core/client',
      ),
    ).toThrow();
  });

  afterAll(() => {
    if (nodePath !== undefined) process.env.NODE_PATH = nodePath;
    isolate();
  });

  beforeEach(() => {
    collector = createTraceCollector();
  });

  afterEach(() => {
    disableAutoInstrumentAWS();
  });

  function s3() {
    const client = new RealS3({
      region: 'us-east-1',
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    });
    // Answer at the first middleware step, so no request leaves the process.
    client.middlewareStack.add(
      () => async () => ({
        output: { $metadata: { httpStatusCode: 200, requestId: 'req-s3' } },
        response: {},
      }),
      { step: 'initialize' },
    );
    return client;
  }

  it('finds the SDK base Client and traces a real client', async () => {
    autoInstrumentAWS();
    expect(isAutoInstrumentEnabled()).toBe(true);

    const response = await s3().send(
      new S3GetObject({ Bucket: 'b', Key: 'k' }),
    );

    expect(response.$metadata.requestId).toBe('req-s3');
    const spans = collector.getSpans();
    expect(spans.map((s) => s.name)).toEqual(['aws.S3.GetObject']);
    expect(spans[0].attributes['aws.request_id']).toBe('req-s3');
  });

  it('stops tracing once disabled', async () => {
    autoInstrumentAWS();
    disableAutoInstrumentAWS();
    await s3().send(new S3GetObject({ Bucket: 'b', Key: 'k' }));
    expect(collector.getSpans()).toHaveLength(0);
  });
});
