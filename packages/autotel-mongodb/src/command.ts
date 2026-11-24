/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof -- boundary: whatever the driver or application passed */
/** A driver command's statement. */
import {
  isPlainObject,
  mapFields,
  serializeMongoStatement,
  withoutValues,
} from './statement';
import {
  batchWithoutValues,
  capped,
  entriesOf,
  updateWithoutValues,
} from './write';

export type MongoCommand = Record<string, unknown>;

/**
 * A whole command's shape: the collections it names are kept, the per-session
 * fields are dropped, and the documents it writes are `?`.
 */
export function commandText(command: MongoCommand): string {
  const text = JSON.stringify(commandWithoutValues(command));
  return isUpdate(command) ? capped(text) : text;
}

/**
 * A command's text with every value as `?`, the collection it names included.
 *
 * @deprecated Use {@link traceMongoCommands}, which also names the collection.
 */
export function serializeMongoCommand(command: unknown): string {
  return isPlainObject(command)
    ? serializeMongoStatement(commandWithoutValues(command))
    : serializeMongoStatement(command);
}

/** The collection a command acts on, when it names one. */
export function commandCollection(command: MongoCommand): string | undefined {
  const explained = explainedCommand(command);
  if (explained) return commandCollection(explained);
  const field = collectionField(command);
  const collection = field === undefined ? undefined : command[field];
  return typeof collection === 'string' ? collection : undefined;
}

/** Names the server also takes, for the one the driver uses. */
const ALIASES = new Map([
  ['findandmodify', 'findAndModify'],
  ['mapreduce', 'mapReduce'],
  ['deleteIndexes', 'dropIndexes'],
  ['collstats', 'collStats'],
]);

/** The field that names the collection a command acts on. */
function collectionField(command: MongoCommand): string | undefined {
  const { key, name } = commandName(command);
  if (name === 'getMore') return 'collection';
  return COLLECTION_COMMANDS.has(name) ? key : undefined;
}

/** The field a command is named by, and the command that is. */
function commandName(command: MongoCommand): { key: string; name: string } {
  const key = Object.keys(command)[0] ?? '';
  return { key, name: ALIASES.get(key) ?? key };
}

/** The command an `explain` runs. Any other command's `explain` is data. */
function explainedCommand(command: MongoCommand): MongoCommand | undefined {
  const isExplain = commandName(command).name === 'explain';
  return isExplain && isPlainObject(command.explain)
    ? command.explain
    : undefined;
}

const UPDATE_COMMANDS = new Set(['update', 'findAndModify', 'bulkWrite']);

function isUpdate(command: MongoCommand): boolean {
  const explained = explainedCommand(command);
  return explained
    ? isUpdate(explained)
    : UPDATE_COMMANDS.has(commandName(command).name);
}

/** Commands whose first field is the collection they act on. */
const COLLECTION_COMMANDS = new Set([
  'find',
  'aggregate',
  'count',
  'distinct',
  'insert',
  'update',
  'delete',
  'findAndModify',
  'create',
  'createIndexes',
  'listIndexes',
  'dropIndexes',
  'drop',
  'collMod',
  'collStats',
  'compact',
  'convertToCapped',
  'mapReduce',
  'validate',
  'killCursors',
  'reIndex',
  'analyze',
  'planCacheClear',
  'planCacheClearFilters',
  'planCacheListFilters',
  'planCacheSetFilter',
  'createSearchIndexes',
  'updateSearchIndex',
  'dropSearchIndex',
]);

/**
 * Keys a driver adds to every command that change per call or per session.
 * Dropping them lets calls share a text.
 */
const SESSION_KEYS = new Set([
  'lsid',
  '$clusterTime',
  '$db',
  'txnNumber',
  'autocommit',
  'startTransaction',
]);

function commandWithoutValues(command: MongoCommand): MongoCommand {
  const { name } = commandName(command);
  const namesCollection = collectionField(command);
  return mapFields(command, (value, key) => {
    if (SESSION_KEYS.has(key)) return undefined;
    return key === namesCollection && typeof value === 'string'
      ? value
      : fieldWithoutValues(command, name, key, value);
  });
}

/** A command's field, read by what that field of that command holds. */
function fieldWithoutValues(
  command: MongoCommand,
  name: string,
  key: string,
  value: unknown,
): unknown {
  switch (`${name}.${key}`) {
    case 'insert.documents': {
      return '?';
    }
    case 'findAndModify.update': {
      return updateWithoutValues(value);
    }
    case 'delete.deletes':
    case 'update.updates': {
      return batchWithoutValues(value, writeWithoutValues);
    }
    case 'bulkWrite.ops': {
      const namespaces = namespacesOf(command.nsInfo);
      return batchWithoutValues(value, (op) =>
        bulkOpWithoutValues(op, namespaces),
      );
    }
    case 'bulkWrite.nsInfo': {
      // Each op carries its own namespace instead.
      return undefined;
    }
    case 'explain.explain': {
      return isPlainObject(value) ? commandWithoutValues(value) : '?';
    }
    default: {
      return withoutValues(value);
    }
  }
}

/** One write of an update, delete or client bulk write command. */
function writeWithoutValues(write: MongoCommand): MongoCommand {
  return mapFields(write, (value, key) => {
    if (key === 'document') return '?';
    return key === 'u' || key === 'updateMods'
      ? updateWithoutValues(value)
      : withoutValues(value);
  });
}

/** The namespaces a client bulk write lists, `?` for one that is not a name. */
function namespacesOf(nsInfo: unknown): string[] {
  return entriesOf(nsInfo).map((info) =>
    isPlainObject(info) && typeof info.ns === 'string' ? info.ns : '?',
  );
}

/** A client bulk write's op, naming the namespace it gives the index of. */
function bulkOpWithoutValues(
  op: MongoCommand,
  namespaces: string[],
): MongoCommand {
  return {
    ...writeWithoutValues(op),
    ...mapFields(
      { insert: op.insert, update: op.update, delete: op.delete },
      (index) => namespaceAt(index, namespaces),
    ),
  };
}

function namespaceAt(index: unknown, namespaces: string[]): string {
  if (typeof index === 'number' || typeof index === 'bigint') {
    return namespaces[Number(index)] ?? '?';
  }
  return namespaces[int32Of(index) ?? -1] ?? '?';
}

/** On the base class of every BSON type, from bson 5. */
const BSON_VERSION = Symbol.for('@@mdb.bson.version');

/**
 * The number in a BSON `Int32`, read off its field without running its methods.
 * Subclasses and instances with added members read as undefined.
 */
function int32Of(index: unknown): number | undefined {
  if (typeof index !== 'object' || index === null || 'toBSON' in index) return;
  const type: object | null = Object.getPrototypeOf(index);
  const base: object | null = type && Object.getPrototypeOf(type);
  // The BSON class itself sits directly on that base.
  if (!type || !base || !Object.hasOwn(base, BSON_VERSION)) return;
  if (!Object.hasOwn(type, '_bsontype')) return;
  if (Reflect.ownKeys(index).length !== 1) return;
  const number: unknown = Object.getOwnPropertyDescriptor(
    index,
    'value',
  )?.value;
  return typeof number === 'number' ? number : undefined;
}
