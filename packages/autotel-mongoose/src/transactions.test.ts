import { describe, it, expect, beforeEach } from 'vitest';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { patchStartSession, type SessionSource } from './transactions';
import type { ResolvedConfig } from './types';

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({
  spanProcessors: [new SimpleSpanProcessor({ exporter })],
});
trace.setGlobalTracerProvider(provider);
const tracer = trace.getTracer('test');
// SAFETY: createSpan reads only the fields set here.
const config = { captureCollectionName: true } as ResolvedConfig;

/** The driver's withTransaction in miniature: it calls both ends through `this`. */
class FakeSession {
  commits: Error[] = [];
  startError: Error | undefined;
  async commitTransaction(): Promise<void> {
    const next = this.commits.shift();
    if (next) throw next;
  }
  async abortTransaction(): Promise<void> {}
  async withTransaction<T>(fn: (s: this) => Promise<T>): Promise<T> {
    if (this.startError) throw this.startError;
    for (;;) {
      let result: T;
      try {
        result = await fn(this);
      } catch (error) {
        await this.abortTransaction();
        if (String(error).includes('transient')) continue;
        throw error;
      }
      await this.commitTransaction();
      return result;
    }
  }
}

function fakeConnection() {
  const prototype = { startSession: async () => new FakeSession() };
  // SAFETY: FakeSession has the three ClientSession methods the patch replaces.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- a fake of a driver class
  const source = prototype as object as SessionSource;
  return { prototype, patch: () => patchStartSession(source, tracer, config) };
}

async function session(): Promise<FakeSession> {
  const { prototype, patch } = fakeConnection();
  patch();
  return prototype.startSession();
}

const names = () => exporter.getFinishedSpans().map((s) => s.name);
const transaction = () =>
  exporter.getFinishedSpans().find((s) => s.name === 'mongoose.transaction')!;

describe('transactions', () => {
  beforeEach(() => exporter.reset());

  it('records a commit', async () => {
    const s = await session();
    expect(await s.withTransaction(async () => 7)).toBe(7);
    expect(names()).toEqual([
      'mongoose.commitTransaction',
      'mongoose.transaction',
    ]);
    expect(transaction().attributes).toMatchObject({
      'db.transaction.attempts': 1,
      'db.transaction.outcome': 'committed',
    });
  });

  it('counts retries', async () => {
    const s = await session();
    let calls = 0;
    await s.withTransaction(async () => {
      if (++calls === 1) throw new Error('transient');
    });
    expect(names()).toEqual([
      'mongoose.abortTransaction',
      'mongoose.commitTransaction',
      'mongoose.transaction',
    ]);
    expect(transaction().attributes).toMatchObject({
      'db.transaction.attempts': 2,
      'db.transaction.outcome': 'committed',
    });
  });

  it('marks an abort as an error', async () => {
    const s = await session();
    const failure = new Error('boom');
    await expect(
      s.withTransaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(transaction().status.code).toBe(SpanStatusCode.ERROR);
    expect(transaction().attributes['db.transaction.outcome']).toBe('aborted');
  });

  it('says so when the commit result was lost', async () => {
    const s = await session();
    s.commits = [
      Object.assign(new Error('lost'), {
        hasErrorLabel: (l: string) => l === 'UnknownTransactionCommitResult',
      }),
    ];
    await expect(s.withTransaction(async () => {})).rejects.toThrow('lost');
    expect(transaction().attributes['db.transaction.outcome']).toBe('unknown');
    expect(
      exporter.getFinishedSpans().find((x) => x.name.includes('commit'))?.status
        .code,
    ).toBe(SpanStatusCode.ERROR);
  });

  it('does not inherit the outcome of an earlier transaction', async () => {
    const s = await session();
    await s.withTransaction(async () => {});
    exporter.reset();
    s.startError = new Error('cannot start');
    await expect(s.withTransaction(async () => {})).rejects.toThrow('cannot');
    expect(transaction().attributes).toMatchObject({
      'db.transaction.attempts': 0,
      'db.transaction.outcome': 'aborted',
    });
  });

  it('keeps its outcome when an overlapping call is refused', async () => {
    const s = await session();
    await s.withTransaction(async () => {
      s.startError = new Error('already in progress');
      await s.withTransaction(async () => {}).catch(() => {});
      s.startError = undefined;
    });
    const outcomes = exporter
      .getFinishedSpans()
      .filter((x) => x.name === 'mongoose.transaction')
      .map((x) => x.attributes['db.transaction.outcome']);
    expect(outcomes).toEqual(['aborted', 'committed']);
  });

  it('does not wrap twice', async () => {
    const { prototype, patch } = fakeConnection();
    patch();
    patch();
    const s = await prototype.startSession();
    await s.withTransaction(async () => {});
    expect(names().filter((n) => n === 'mongoose.transaction')).toHaveLength(1);
  });
});
