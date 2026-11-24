/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof -- boundary: whatever the driver or application passed */
/** A Mongoose operation's statement. */
import { isPlainObject, mapFields, withoutValues } from './statement';
import {
  batchWithoutValues,
  capped,
  updateWithoutValues,
  type Strip,
} from './write';

/** What a Mongoose operation was called with. */
export interface MongoPayload {
  condition?: unknown;
  updates?: unknown;
  updatePipeline?: unknown;
  options?: unknown;
  fields?: unknown;
  aggregatePipeline?: unknown;
  document?: unknown;
  documents?: unknown;
  operations?: unknown;
}

/**
 * The operation's shape: written documents are `?`, and shorthand updates read
 * as the `$set` Mongoose sends.
 */
export function serializeMongoPayload(
  operation: string,
  payload: MongoPayload,
): string {
  const text = JSON.stringify(
    payloadWithoutValues(operation, payload, (value) => withoutValues(value)),
  );
  const isUpdate =
    payload.updates ?? payload.updatePipeline ?? payload.operations;
  return isUpdate === undefined ? text : capped(text);
}

/**
 * The text `db.statement.hash` is taken from: {@link serializeMongoPayload}
 * with the fields an update writes dropped too, leaving its operators. Which
 * fields a write happens to set varies per call; the operation and its filter
 * do not.
 */
export function mongoPayloadKey(
  operation: string,
  payload: MongoPayload,
): string {
  return JSON.stringify(payloadWithoutValues(operation, payload, () => '?'));
}

const REPLACEMENTS = new Set(['replaceOne', 'findOneAndReplace']);

function payloadWithoutValues(
  operation: string,
  payload: MongoPayload,
  stripUpdated: Strip,
): Record<string, unknown> {
  return mapFields({ ...payload }, (value, key) => {
    switch (key) {
      case 'document':
      case 'documents': {
        return '?';
      }
      case 'updates':
      case 'updatePipeline': {
        return REPLACEMENTS.has(operation)
          ? '?'
          : updateWithoutValues(shorthandAsSet(value), stripUpdated);
      }
      case 'operations': {
        return batchWithoutValues(value, (entry) =>
          bulkWriteWithoutValues(entry, stripUpdated),
        );
      }
      default: {
        return withoutValues(value);
      }
    }
  });
}

/** `{ updateOne: { filter, update } }`, as `Model.bulkWrite()` takes it. */
function bulkWriteWithoutValues(
  write: Record<string, unknown>,
  stripUpdated: Strip,
): Record<string, unknown> {
  return mapFields(write, (args) => {
    if (!isPlainObject(args)) return '?';
    return mapFields(args, (value, key) => {
      if (key === 'document' || key === 'replacement') return '?';
      return key === 'update'
        ? updateWithoutValues(shorthandAsSet(value), stripUpdated)
        : withoutValues(value);
    });
  });
}

/** Mongoose sends an update's fields with no operator as `$set`. */
function shorthandAsSet(update: unknown): unknown {
  if (!isPlainObject(update)) return update;
  const entries = Object.entries(update);
  const fields = entries.filter(([key]) => !key.startsWith('$'));
  if (fields.length === 0) return update;
  return {
    ...Object.fromEntries(entries.filter(([key]) => key.startsWith('$'))),
    $set: {
      ...(isPlainObject(update.$set) ? update.$set : undefined),
      ...Object.fromEntries(fields),
    },
  };
}
