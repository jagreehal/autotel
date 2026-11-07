import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canListenOnLoopback } from './test-support';
import { watchTransitions } from './watch-transitions';

const { transition } = vi.hoisted(() => ({ transition: vi.fn() }));
vi.mock('autotel', async (original) => ({
  ...(await original<typeof import('autotel')>()),
  transition,
}));

const canListen = await canListenOnLoopback();

describe.skipIf(!canListen)('watchTransitions on a real change stream', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;

  beforeAll(async () => {
    // Change streams need a replica set, so test-support's single node won't do.
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    connection = await mongoose
      .createConnection(replSet.getUri(), { dbName: 'transitions' })
      .asPromise();
  });

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  const arrives = (seen: () => number) =>
    vi.waitFor(() => expect(seen()).toBeGreaterThan(0), { timeout: 10_000 });

  /** The stream has no ready event; a short wait lets its cursor open. */
  const streamOpen = () => new Promise((resolve) => setTimeout(resolve, 500));

  it('records from a pre-image, through a Mongoose model', async () => {
    transition.mockClear();
    await connection.createCollection('orders_with_images', {
      changeStreamPreAndPostImages: { enabled: true },
    });
    // The model would otherwise create the collection itself, without pre-images.
    const Order = connection.model(
      'Order',
      new mongoose.Schema(
        { status: String, total: Number },
        { autoCreate: false },
      ),
      'orders_with_images',
    );
    const watcher = watchTransitions(Order, {
      entity: 'order',
      field: 'status',
    });
    await streamOpen();

    const order = await Order.create({ status: 'pending', total: 3 });
    await Order.updateOne({ _id: order._id }, { $set: { status: 'paid' } });
    await Order.updateOne({ _id: order._id }, { $set: { total: 4 } });
    await arrives(() => watcher.recorded);
    await watcher.close();

    expect(transition).toHaveBeenCalledExactlyOnceWith({
      entity: 'order',
      field: 'status',
      from: 'pending',
      to: 'paid',
      via: 'unknown',
      id: String(order._id),
    });
    expect(watcher.skipped).toBe(0);
  });

  it('records a nested field when its parent is replaced', async () => {
    transition.mockClear();
    const orders = connection.collection('orders_nested');
    await connection.createCollection('orders_nested', {
      changeStreamPreAndPostImages: { enabled: true },
    });
    const watcher = watchTransitions(orders, {
      entity: 'order',
      field: 'workflow.state.status',
    });
    await streamOpen();

    const { insertedId } = await orders.insertOne({
      workflow: { state: { status: 'open' } },
    });
    await orders.updateOne(
      { _id: insertedId },
      { $set: { 'workflow.state': { status: 'paid' } } },
    );
    await arrives(() => watcher.recorded);
    await watcher.close();

    expect(transition).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ from: 'open', to: 'paid' }),
    );
  });

  it('skips and counts with no pre-images, on a driver collection', async () => {
    transition.mockClear();
    const name = 'orders_without_images';
    await connection.createCollection(name);
    const collection = connection
      .getClient()
      .db('transitions')
      .collection(name);
    const watcher = watchTransitions(collection, {
      entity: 'order',
      field: 'status',
    });
    await streamOpen();

    const { insertedId } = await collection.insertOne({ status: 'pending' });
    await collection.updateOne(
      { _id: insertedId },
      { $set: { status: 'paid' } },
    );
    await arrives(() => watcher.skipped);
    await watcher.close();

    expect(transition).not.toHaveBeenCalled();
    expect(watcher.recorded).toBe(0);
  });
});
