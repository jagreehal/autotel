import { transition, type TransitionInput } from 'autotel';

/**
 * The part of a change event this reads. MongoDB sends more; see
 * https://www.mongodb.com/docs/manual/reference/change-events/
 */
export interface TransitionChange {
  operationType: string;
  documentKey?: { _id?: unknown };
  updateDescription?: { updatedFields?: Record<string, unknown> | null };
  fullDocument?: Record<string, unknown> | null;
  fullDocumentBeforeChange?: Record<string, unknown> | null;
}

export interface TransitionChangeStream {
  on(event: 'change', listener: (change: TransitionChange) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  close(): Promise<unknown> | unknown;
}

/** A driver `Collection` or a Mongoose `Model`: anything with `watch()`. */
export interface WatchableCollection {
  watch(
    pipeline: Array<Record<string, unknown>>,
    options: { fullDocumentBeforeChange: 'whenAvailable' },
  ): TransitionChangeStream;
}

export interface WatchTransitionsOptions {
  /** The kind of thing this collection holds, e.g. `order`. */
  entity: string;
  /** The field holding its state, e.g. `status`. Dotted paths are allowed. */
  field: string;
  /** Called after each recorded transition, with the document's id. */
  onTransition?: (recorded: WatchedTransition) => void;
  /**
   * Called when the stream fails or `onTransition` throws. Pass this: a change
   * stream that fails stops delivering, and nothing here restarts it.
   */
  onError?: (error: unknown) => void;
}

export type WatchedTransition = Required<
  Pick<TransitionInput, 'entity' | 'field' | 'from' | 'to' | 'via' | 'id'>
>;

export interface TransitionWatcher {
  /** Transitions recorded so far. */
  readonly recorded: number;
  /**
   * Changes to the field that were not recorded because a state could not be
   * read, usually a missing pre-image. A number that keeps rising beside a flat
   * `recorded` means pre-images are not enabled on the collection.
   */
  readonly skipped: number;
  close(): Promise<void>;
}

const isState = (value: unknown): value is string | number | boolean =>
  value !== '' && ['string', 'number', 'boolean'].includes(typeof value);

function readKeys(document: unknown, keys: string[]): unknown {
  let value = document;
  for (const key of keys) {
    if (typeof value !== 'object' || value === null) return undefined;
    // SAFETY: the guard above established a non-null object; the value read
    // is `unknown` and is checked by the caller before use.
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

const readPath = (document: unknown, path: string): unknown =>
  readKeys(document, path.split('.'));

/**
 * The state a change wrote. An update's keys are dotted paths, so the field can
 * sit under its own key or inside a replaced parent at any depth:
 * `a.b.c`, `a.b: { c }` or `a: { b: { c } }`. `undefined` when it left it alone.
 */
function writtenState(change: TransitionChange, field: string): unknown {
  if (change.operationType === 'replace') {
    return readPath(change.fullDocument, field);
  }
  const updated = change.updateDescription?.updatedFields ?? {};
  const keys = field.split('.');
  for (let depth = keys.length; depth > 0; depth -= 1) {
    const key = keys.slice(0, depth).join('.');
    if (Object.hasOwn(updated, key)) {
      return readKeys(updated[key], keys.slice(depth));
    }
  }
  return undefined;
}

/**
 * Prototype. Record transitions of one field from a MongoDB change stream, for
 * writes no application code can be changed to report.
 *
 * Prefer calling `transition()` beside the write. A database cannot know the
 * business operation, so `via` is always `unknown`, and each process running a
 * watcher counts every change. See the README.
 *
 * Needs a replica set, MongoDB 6.0+, and pre-images on the collection
 * (`collMod` with `changeStreamPreAndPostImages: { enabled: true }`). Without a
 * pre-image `from` is unknown, and this never guesses it: the change is counted
 * in `skipped` and nothing is recorded.
 *
 * @example
 * ```typescript
 * const watcher = watchTransitions(Order, {
 *   entity: 'order',
 *   field: 'status',
 *   onError: (error) => logger.error({ error }, 'transition watcher failed'),
 * });
 * ```
 */
export function watchTransitions(
  collection: WatchableCollection,
  options: WatchTransitionsOptions,
): TransitionWatcher {
  const { entity, field, onTransition, onError } = options;
  let recorded = 0;
  let skipped = 0;

  const stream = collection.watch(
    [{ $match: { operationType: { $in: ['update', 'replace'] } } }],
    // `required` would fail the whole stream on the first missing pre-image.
    { fullDocumentBeforeChange: 'whenAvailable' },
  );

  stream.on('change', (change) => {
    const to = writtenState(change, field);
    if (to === undefined) return;
    const from = readPath(change.fullDocumentBeforeChange, field);
    if (!isState(from) || !isState(to)) {
      skipped += 1;
      return;
    }
    if (from === to) return;

    const moved: WatchedTransition = {
      entity,
      field,
      from: String(from),
      to: String(to),
      via: 'unknown',
      id: String(change.documentKey?._id),
    };
    transition(moved);
    recorded += 1;
    try {
      onTransition?.(moved);
    } catch (error) {
      onError?.(error);
    }
  });

  // An EventEmitter with no 'error' listener throws, which would take the
  // process down over a telemetry stream.
  stream.on('error', (error) => onError?.(error));

  return {
    get recorded() {
      return recorded;
    },
    get skipped() {
      return skipped;
    },
    async close() {
      await stream.close();
    },
  };
}
