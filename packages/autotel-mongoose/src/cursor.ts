import {
  asFunction,
  asRecord,
  callFunction,
  isFunction,
  toError,
} from './values.js';

/** What `next()` resolves to once an async-iterator cursor is exhausted. */
function isIteratorDone(value: any): boolean {
  const record = asRecord(value);
  return (
    record !== undefined &&
    Object.keys(record).length === 1 &&
    record.done === true
  );
}

/**
 * Calls `end` once, when the cursor a Query or Aggregate returned is done:
 * `next()` reports the end or rejects, `eachAsync()` settles, or the caller
 * closes it. `for await` reads through `next()`.
 *
 * A stream reader (`.on('data')`, `pipe`) calls none of these, so for it the
 * driver cursor closing is the end, a tick later so an `error` the cursor
 * emits first is the outcome. The error is read off `emit`, not a listener:
 * a listener would turn an unhandled stream error into a handled one.
 */
export function traceCursor(cursor: any, end: (error?: Error) => void): any {
  if (!asRecord(cursor)) {
    end();
    return cursor;
  }
  let pulled = false;
  let ended = false;
  const endOnce = (error?: Error): void => {
    if (ended) return;
    ended = true;
    end(error);
  };
  const settleWith = (method: string, isEnd: (value: any) => boolean): void => {
    const original = asFunction(cursor[method]);
    if (!original) return;
    cursor[method] = function traced(...args: any[]): Promise<any> {
      pulled = true;
      return Promise.resolve(callFunction(original, cursor, args)).then(
        (value: any) => {
          if (isEnd(value)) endOnce();
          return value;
        },
        (error: any) => {
          endOnce(toError(error));
          throw error;
        },
      );
    };
  };
  settleWith('next', (doc) => doc === null || isIteratorDone(doc));
  settleWith('eachAsync', () => true);
  settleWith('close', () => true);

  const emit = asFunction(cursor.emit);
  if (emit) {
    cursor.emit = function tracedEmit(event: any, ...args: any[]): any {
      if (event === 'error') endOnce(toError(args[0]));
      return callFunction(emit, cursor, [event, ...args]);
    };
  }
  if (isFunction(cursor.once)) {
    cursor.once('cursor', (driverCursor: any) => {
      if (!isFunction(driverCursor?.once)) return;
      driverCursor.once('close', () => {
        if (!pulled) setImmediate(() => endOnce());
      });
    });
  }
  return cursor;
}
