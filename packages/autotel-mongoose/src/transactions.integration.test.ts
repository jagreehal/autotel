import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import mongoose from 'mongoose';
import { instrumentMongoose } from './instrumentation';
import { startMongo } from './test-support';

/** Transactions need a replica set: MONGO_TEST_URI's, or an in-memory one. */
async function connectToReplicaSet(): Promise<() => Promise<void>> {
  const provided = process.env.MONGO_TEST_URI;
  if (provided) {
    const { uri, stop } = await startMongo('transactions');
    await mongoose.connect(uri);
    const hello = await mongoose.connection.db?.command({ hello: 1 });
    if (hello?.setName) return stop;
    await mongoose.disconnect();
    await stop();
  }
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(server.getUri('transactions'));
  return async () => {
    await server.stop();
  };
}

describe('transactions', () => {
  const exporter = new InMemorySpanExporter();
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    trace.setGlobalTracerProvider(
      new TracerProvider({
        spanProcessors: [new SimpleSpanProcessor({ exporter })],
      }),
    );
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    instrumentMongoose(mongoose);
    stop = await connectToReplicaSet();
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await stop?.();
  });

  it('nests the writes and the commit under the transaction', async () => {
    const Item = mongoose.model(
      'Item',
      new mongoose.Schema({ n: Number }, { strict: false }),
    );
    await Item.createCollection();
    exporter.reset();
    await mongoose.connection.transaction(async (session) => {
      await Item.create([{ n: 1 }], { session });
    });
    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === 'mongoose.transaction')!;
    expect(parent.attributes).toMatchObject({
      'db.transaction.attempts': 1,
      'db.transaction.outcome': 'committed',
    });
    const children = spans
      .filter(
        (s) => s.parentSpanContext?.spanId === parent.spanContext().spanId,
      )
      .map((s) => s.name);
    expect(children).toEqual(['create items', 'mongoose.commitTransaction']);
  });

  it('does not inherit the outcome of an earlier transaction on the session', async () => {
    const Item = mongoose.model('Item');
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await Item.create([{ n: 2 }], { session });
    });
    exporter.reset();
    let ran = false;
    await expect(
      session.withTransaction(
        async () => {
          ran = true;
        },
        { writeConcern: { w: 0 } },
      ),
    ).rejects.toThrow('unacknowledged');
    await session.endSession();
    expect(ran).toBe(false);
    expect(
      exporter.getFinishedSpans().find((s) => s.name === 'mongoose.transaction')
        ?.attributes,
    ).toMatchObject({
      'db.transaction.attempts': 0,
      'db.transaction.outcome': 'aborted',
    });
  });

  it('marks an aborted transaction', async () => {
    exporter.reset();
    await expect(
      mongoose.connection.transaction(async () => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(
      exporter.getFinishedSpans().find((s) => s.name === 'mongoose.transaction')
        ?.attributes['db.transaction.outcome'],
    ).toBe('aborted');
  });
});
