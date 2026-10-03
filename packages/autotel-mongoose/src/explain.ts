import type { SerializerPayload } from './types';

/** A driver command document. */
export type MongoCommand = Record<string, unknown>;

/**
 * The driver command an operation sent, rebuilt from the settled query, for
 * `db.command({ explain: <it>, verbosity })`.
 *
 * Explain goes to the driver rather than through `query.clone().explain()`,
 * because a Mongoose query runs its pre and post middleware on every exec:
 * explaining that way runs the application's hooks a second time, and a hook
 * that sends a notification or writes an audit record repeats it. A raw
 * command runs no middleware. The filter and update are read after the query
 * settled, by which point Mongoose has cast them, so the plan is the one the
 * real query got.
 *
 * Returns `undefined` for an operation with no plan to show.
 */
export function explainCommand(
  operation: string,
  collection: string,
  payload: SerializerPayload,
): MongoCommand | undefined {
  const filter = payload.condition ?? {};
  const options = payload.options ?? {};
  const sort = options.sort;
  // What changes how the server runs the query, and so the plan it picks: a
  // `hint` forcing an index or a scan, a `collation` that rules out an index
  // built with another one, `min` / `max` index bounds. Dropping them explains
  // a different query from the one that ran.
  const planning = {
    hint: options.hint,
    collation: options.collation,
  };

  switch (operation) {
    case 'find':
    case 'findOne':
    case 'findById': {
      return defined({
        find: collection,
        filter,
        projection: payload.fields,
        sort,
        skip: options.skip,
        limit: operation === 'find' ? options.limit : 1,
        ...planning,
        min: options.min,
        max: options.max,
        allowDiskUse: options.allowDiskUse,
        let: options.let,
      });
    }
    case 'countDocuments': {
      return defined({
        count: collection,
        query: filter,
        skip: options.skip,
        limit: options.limit,
        ...planning,
      });
    }
    case 'updateOne':
    case 'updateMany': {
      return defined({
        update: collection,
        updates: [
          defined({
            q: filter,
            u: payload.updates ?? {},
            multi: operation === 'updateMany',
            upsert: options.upsert,
            arrayFilters: options.arrayFilters,
            ...planning,
          }),
        ],
        let: options.let,
      });
    }
    case 'deleteOne':
    case 'deleteMany': {
      return defined({
        delete: collection,
        deletes: [
          defined({
            q: filter,
            limit: operation === 'deleteOne' ? 1 : 0,
            ...planning,
          }),
        ],
        let: options.let,
      });
    }
    case 'findOneAndUpdate':
    case 'findOneAndReplace': {
      return defined({
        findAndModify: collection,
        query: filter,
        sort,
        update: payload.updates ?? {},
        upsert: options.upsert,
        arrayFilters: options.arrayFilters,
        ...planning,
        let: options.let,
      });
    }
    case 'findOneAndDelete': {
      return defined({
        findAndModify: collection,
        query: filter,
        sort,
        remove: true,
        ...planning,
        let: options.let,
      });
    }
    case 'aggregate': {
      return defined({
        aggregate: collection,
        pipeline: payload.aggregatePipeline ?? [],
        cursor: {},
        ...planning,
        allowDiskUse: options.allowDiskUse,
        let: options.let,
      });
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Drop absent fields. The driver serializes `undefined` as `null` unless told
 * otherwise, and `limit: null` is a different command.
 */
function defined(command: MongoCommand): MongoCommand {
  return Object.fromEntries(
    Object.entries(command).filter(([, value]) => value !== undefined),
  );
}
