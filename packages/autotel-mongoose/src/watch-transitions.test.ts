import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  watchTransitions,
  type TransitionChange,
  type TransitionChangeStream,
} from './watch-transitions';

const { transition } = vi.hoisted(() => ({ transition: vi.fn() }));
vi.mock('autotel', () => ({ transition }));

function fakeCollection() {
  // oxlint-disable-next-line unicorn/prefer-event-target -- change streams are EventEmitters, and an unhandled 'error' throwing is the behaviour under test.
  const emitter = new EventEmitter();
  const close = vi.fn().mockResolvedValue(undefined);
  // SAFETY: an EventEmitter's `on` covers both overloads of the stream's.
  const stream = Object.assign(emitter, { close }) as TransitionChangeStream &
    EventEmitter;
  const watch = vi.fn(() => stream);
  return { collection: { watch }, stream, watch, close };
}

const statusUpdate = (
  from: Record<string, unknown> | null,
  updatedFields: Record<string, unknown>,
): TransitionChange => ({
  operationType: 'update',
  documentKey: { _id: 'order-1' },
  updateDescription: { updatedFields },
  fullDocumentBeforeChange: from,
});

describe('watchTransitions', () => {
  beforeEach(() => {
    transition.mockClear();
  });

  function watching(options = {}) {
    const fake = fakeCollection();
    const watcher = watchTransitions(fake.collection, {
      entity: 'order',
      field: 'status',
      ...options,
    });
    return { ...fake, watcher };
  }

  it('asks for pre-images without failing when one is missing', () => {
    const { watch } = watching();
    expect(watch).toHaveBeenCalledWith(
      [{ $match: { operationType: { $in: ['update', 'replace'] } } }],
      { fullDocumentBeforeChange: 'whenAvailable' },
    );
  });

  it('records an update, with via always unknown', () => {
    const onTransition = vi.fn();
    const { stream, watcher } = watching({ onTransition });

    stream.emit(
      'change',
      statusUpdate({ status: 'pending' }, { status: 'paid' }),
    );

    const moved = {
      entity: 'order',
      field: 'status',
      from: 'pending',
      to: 'paid',
      via: 'unknown',
      id: 'order-1',
    };
    expect(transition).toHaveBeenCalledExactlyOnceWith(moved);
    expect(onTransition).toHaveBeenCalledExactlyOnceWith(moved);
    expect(watcher.recorded).toBe(1);
    expect(watcher.skipped).toBe(0);
  });

  it('records a replace from the document it wrote', () => {
    const { stream } = watching();

    stream.emit('change', {
      operationType: 'replace',
      documentKey: { _id: 'order-1' },
      fullDocument: { status: 'paid' },
      fullDocumentBeforeChange: { status: 'pending' },
    });

    expect(transition).toHaveBeenCalledOnce();
  });

  it('skips and counts a change with no pre-image, and never guesses', () => {
    const { stream, watcher } = watching();

    stream.emit('change', statusUpdate(null, { status: 'paid' }));

    expect(transition).not.toHaveBeenCalled();
    expect(watcher.skipped).toBe(1);
    expect(watcher.recorded).toBe(0);
  });

  it('skips and counts an empty state, which transition() refuses', () => {
    const onTransition = vi.fn();
    const { stream, watcher } = watching({ onTransition });

    stream.emit('change', statusUpdate({ status: '' }, { status: 'paid' }));

    expect(onTransition).not.toHaveBeenCalled();
    expect(watcher.recorded).toBe(0);
    expect(watcher.skipped).toBe(1);
  });

  it('skips and counts a pre-image without the field', () => {
    const { stream, watcher } = watching();

    stream.emit('change', statusUpdate({ total: 3 }, { status: 'paid' }));

    expect(transition).not.toHaveBeenCalled();
    expect(watcher.skipped).toBe(1);
  });

  it('ignores an update that left the field alone, pre-image or not', () => {
    const { stream, watcher } = watching();

    stream.emit('change', statusUpdate(null, { total: 4 }));

    expect(transition).not.toHaveBeenCalled();
    expect(watcher.skipped).toBe(0);
  });

  it('ignores a replace that kept the state', () => {
    const { stream, watcher } = watching();

    stream.emit('change', {
      operationType: 'replace',
      documentKey: { _id: 'order-1' },
      fullDocument: { status: 'paid', total: 4 },
      fullDocumentBeforeChange: { status: 'paid', total: 3 },
    });

    expect(transition).not.toHaveBeenCalled();
    expect(watcher.skipped).toBe(0);
  });

  it.each([
    ['its dotted path', { 'state.current': 'paid' }],
    ['a replaced parent', { state: { current: 'paid' } }],
  ])('reads a nested field through %s', (_, updatedFields) => {
    const { stream } = watching({ field: 'state.current' });

    stream.emit(
      'change',
      statusUpdate({ state: { current: 'pending' } }, updatedFields),
    );

    expect(transition).toHaveBeenCalledOnce();
  });

  it('survives a stream error and reports it', () => {
    const onError = vi.fn();
    const { stream } = watching({ onError });
    const failure = new Error('resume token lost');

    stream.emit('error', failure);

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('does not crash on a stream error with no handler', () => {
    const { stream } = watching();
    expect(() => stream.emit('error', new Error('down'))).not.toThrow();
  });

  it('keeps watching when onTransition throws', () => {
    const failure = new Error('handler failed');
    const onError = vi.fn();
    const { stream, watcher } = watching({
      onError,
      onTransition: () => {
        throw failure;
      },
    });
    const change = statusUpdate({ status: 'pending' }, { status: 'paid' });

    expect(() => stream.emit('change', change)).not.toThrow();
    stream.emit('change', change);

    expect(onError).toHaveBeenCalledWith(failure);
    expect(watcher.recorded).toBe(2);
  });

  describe('a dotted field', () => {
    const field = 'workflow.state.status';
    const before = { workflow: { state: { status: 'open' } } };

    it.each([
      ['its own key', { 'workflow.state.status': 'paid' }],
      ['a dotted parent', { 'workflow.state': { status: 'paid' } }],
      ['a top-level parent', { workflow: { state: { status: 'paid' } } }],
    ])('records an update through %s', (_name, updatedFields) => {
      const { stream, watcher } = watching({ field });
      stream.emit('change', statusUpdate(before, updatedFields));

      expect(watcher.recorded).toBe(1);
      expect(transition).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'open', to: 'paid', field }),
      );
    });

    it('skips a null written at its own key', () => {
      const { stream, watcher } = watching({ field });
      stream.emit(
        'change',
        statusUpdate(before, { 'workflow.state.status': null }),
      );

      expect(watcher.skipped).toBe(1);
    });

    it('ignores an update to a sibling', () => {
      const { stream, watcher } = watching({ field });
      stream.emit(
        'change',
        statusUpdate(before, { 'workflow.state.owner': 'ana' }),
      );

      expect([watcher.recorded, watcher.skipped]).toEqual([0, 0]);
    });
  });

  it('closes the stream', async () => {
    const { watcher, close } = watching();
    await watcher.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
