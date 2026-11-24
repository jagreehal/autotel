/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- boundary: another package's internals */
import { commandCollection, commandText, type MongoCommand } from './command';
import { isPlainObject } from './statement';

interface MongoInstrumentationConfig {
  dbStatementSerializer?: (command: Record<string, unknown>) => string;
}

/** The public part of `MongoDBInstrumentation` this uses. */
interface MongoInstrumentation {
  getConfig(): MongoInstrumentationConfig;
  setConfig(config?: MongoInstrumentationConfig): void;
}

type SpanAttributes = Record<string, unknown>;

/** `(connection or namespace, namespace or topology, command, operation)` */
type DescribeSpan = (
  first: unknown,
  second: unknown,
  command: unknown,
  operation: string | undefined,
) => SpanAttributes;

/** Private upstream methods, optional so a rename is detected. */
interface SpanDescribers {
  _getV4SpanAttributes?: DescribeSpan;
  _getV3SpanAttributes?: DescribeSpan;
}

const COLLECTION = 'db.collection.name';

/**
 * Gives `@opentelemetry/instrumentation-mongodb` spans the text and collection
 * of the command they ran, read in the method that describes a span. A
 * `dbStatementSerializer` you configure keeps the text.
 *
 * ```ts
 * init({
 *   instrumentations: [traceMongoCommands(new MongoDBInstrumentation())],
 * });
 * ```
 */
export function traceMongoCommands<T extends MongoInstrumentation>(
  instrumentation: T,
): T {
  // The text of any command the describers below leave unread.
  const fallbackText = () => '"?"';
  // Keeps the fallback in place across later `setConfig()` calls.
  const setConfig = instrumentation.setConfig.bind(instrumentation);
  instrumentation.setConfig = (config = {}) => {
    const { dbStatementSerializer } = config;
    setConfig({
      ...config,
      dbStatementSerializer:
        typeof dbStatementSerializer === 'function'
          ? dbStatementSerializer
          : fallbackText,
    });
  };
  instrumentation.setConfig(instrumentation.getConfig());
  /** Read per span, since `setConfig()` can add or drop a serializer. */
  const ownsText = (): boolean =>
    instrumentation.getConfig().dbStatementSerializer === fallbackText;

  // SAFETY: MongoDBInstrumentation declares these private, so T cannot show
  // them. Each is checked before it is replaced.
  const describers = instrumentation as SpanDescribers;
  const describeWith = (
    method: keyof SpanDescribers,
    /** The collection the call names, when it differs from upstream's. */
    collectionOf: (first: unknown) => string | undefined,
    toCommand: (
      command: unknown,
      operation: string | undefined,
      collection: unknown,
    ) => MongoCommand | undefined,
  ): void => {
    const original = describers[method];
    if (!original) {
      console.warn(
        `[autotel-mongodb] This version of @opentelemetry/instrumentation-mongodb has no ${method}, so the spans it describes keep upstream's collection names, and their query text is "?" unless you set a dbStatementSerializer.`,
      );
      return;
    }
    describers[method] = (first, second, passed, operation) => {
      const owned = ownsText();
      const attributes = original.call(
        instrumentation,
        first,
        second,
        // Upstream reads the command for its text alone, so the driver gets it
        // untouched.
        owned && passed ? {} : passed,
        operation,
      );
      try {
        // The span is named after this.
        attributes[COLLECTION] = collectionOf(first) ?? attributes[COLLECTION];
        const command = toCommand(passed, operation, attributes[COLLECTION]);
        if (!command) return attributes;
        attributes[COLLECTION] =
          commandCollection(command) ?? attributes[COLLECTION];
        if (owned) attributes['db.query.text'] = commandText(command);
      } catch {
        // The command runs either way; the span keeps what it has.
      }
      return attributes;
    };
  };

  describeWith('_getV4SpanAttributes', () => undefined, asCommand);
  describeWith('_getV3SpanAttributes', driver3Collection, driver3Command);
  return instrumentation;
}

function asCommand(passed: unknown): MongoCommand | undefined {
  return isPlainObject(passed) ? passed : undefined;
}

/** The whole collection name, dots included. */
function driver3Collection(namespace: unknown): string | undefined {
  return /^[^.]+\.(.+)$/.exec(String(namespace))?.[1];
}

/** Driver 3 passes the parts of a read or write, and any other command whole. */
function driver3Command(
  passed: unknown,
  operation: string | undefined,
  collection: unknown,
): MongoCommand | undefined {
  if (!isPlainObject(passed)) return undefined;
  switch (operation) {
    case 'insert': {
      return { insert: collection, documents: [passed] };
    }
    case 'update': {
      return { update: collection, updates: [passed] };
    }
    case 'remove': {
      return { delete: collection, deletes: [passed] };
    }
    case 'find': {
      // A query has its filter under `query`. Without one it is a command, as is
      // the query of the `$cmd` collection.
      const { query, ...rest } = passed;
      if (query === undefined) return passed;
      return collection === '$cmd'
        ? asCommand(readQuery(query))
        : { ...rest, find: collection, filter: query };
    }
    case 'getMore': {
      return { getMore: '?', collection };
    }
    default: {
      return passed;
    }
  }
}

/** Driver 3 wraps a command sent with a read preference in `$query`. */
function readQuery(query: unknown): unknown {
  return isPlainObject(query) && '$query' in query ? query.$query : query;
}
