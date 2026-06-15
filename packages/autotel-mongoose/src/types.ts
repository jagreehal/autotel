import type { AttributeRedactorPreset, AttributeRedactorConfig } from 'autotel';

/**
 * Payload passed to the dbStatementSerializer.
 * Shape matches @opentelemetry/instrumentation-mongodb for migration compatibility.
 */
export interface SerializerPayload {
  condition?: Record<string, unknown>;
  updates?: Record<string, unknown>;
  options?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  aggregatePipeline?: unknown[];
  document?: unknown;
  documents?: unknown[];
  operations?: unknown[];
}

/**
 * Configuration for Mongoose instrumentation.
 */
export interface InstrumentMongooseConfig {
  /** Database name for spans (sets db.namespace). */
  dbName?: string;

  /** MongoDB server hostname (sets server.address). */
  peerName?: string;

  /** MongoDB server port (sets server.port, default: 27017). */
  peerPort?: number;

  /** Custom tracer name (default: "autotel-mongoose"). */
  tracerName?: string;

  /** Capture collection names in spans (default: true). */
  captureCollectionName?: boolean;

  /** Instrument Schema hooks — pre/post save, validate, etc. (default: false). */
  instrumentHooks?: boolean;

  /**
   * Serializer for db.query.text attribute.
   * Default: JSON.stringify of the payload.
   * Pass false to disable statement capture entirely.
   */
  dbStatementSerializer?:
    | ((operation: string, payload: SerializerPayload) => string | undefined)
    | false;

  /**
   * Redactor applied to serialized statements before setting db.query.text.
   * Default: 'default' preset (emails, phones, SSNs, credit cards).
   * Pass a preset name, custom config, or false to disable redaction.
   */
  statementRedactor?: AttributeRedactorPreset | AttributeRedactorConfig | false;

  /**
   * Instrument user-defined statics, instance methods, and query helpers
   * (the functions you add via `schema.statics`, `schema.methods`,
   * `schema.query`). These are invisible to the built-in Model/Query
   * instrumentation — this option traces them automatically, with no manual
   * `trace()` calls and no behavioural side effects.
   *
   * - Omitted or `true` → wrap **every** custom static, method, and query
   *   helper and capture their (redacted) parameters. Maximum observability.
   * - `false` → wrap nothing.
   * - object → fine-grained control per category and over parameter capture,
   *   for privacy/compliance. Anything not explicitly disabled stays on.
   *
   * Requires calling `instrumentMongoose()` BEFORE `mongoose.model()` so the
   * functions can be wrapped as models compile (same ordering rule as hooks).
   *
   * @default true
   */
  customMethods?: boolean | CustomMethodsConfig;
}

/**
 * Selects which named functions in a category get instrumented.
 *
 * - `true` (or omitted) → all functions in the category.
 * - `false` → none.
 * - `string[]` → opt-in: only the named functions.
 * - `{ include, exclude }` → opt-in to `include` (all when omitted), then
 *   subtract `exclude`. Use `exclude` to opt specific functions out for
 *   privacy/compliance while still instrumenting everything else.
 */
export type MethodSelector =
  | boolean
  | string[]
  | { include?: string[]; exclude?: string[] };

/**
 * Controls capture of arguments passed to instrumented custom functions.
 */
export interface ParameterCaptureConfig {
  /**
   * Max length of the serialized parameter string (default: 2048).
   * Longer values are truncated with a `…[truncated]` marker.
   */
  maxLength?: number;

  /**
   * Redactor applied to serialized parameters.
   * Default: inherits the instrumentation's `statementRedactor`.
   * Pass a preset name, custom config, or `false` to disable redaction.
   */
  redactor?: AttributeRedactorPreset | AttributeRedactorConfig | false;

  /**
   * Custom serializer for the argument list. Return `undefined` to skip the
   * `mongoose.method.parameters` attribute. The default safely JSON-encodes
   * args (resolving Mongoose documents via `toObject()`, handling BigInt,
   * functions, and circular references).
   */
  serializer?: (
    args: readonly unknown[],
    context: { methodName: string; methodType: CustomMethodType },
  ) => string | undefined;
}

/** The three kinds of user-defined functions Mongoose supports. */
export type CustomMethodType = 'static' | 'instance' | 'query';

/**
 * Fine-grained custom-method instrumentation config. Every field defaults to
 * the most-observable setting; specify a field only to narrow it.
 */
export interface CustomMethodsConfig {
  /** Statics (`schema.statics` → `Model.foo()`). Default: all. */
  statics?: MethodSelector;
  /** Instance methods (`schema.methods` → `doc.foo()`). Default: all. */
  methods?: MethodSelector;
  /** Query helpers (`schema.query` → `Model.find().foo()`). Default: all. */
  query?: MethodSelector;
  /**
   * Capture arguments as the `mongoose.method.parameters` span attribute.
   * Default: `true` (redacted with `statementRedactor`). Pass `false` to
   * disable, or an object for fine-grained control.
   */
  captureParameters?: boolean | ParameterCaptureConfig;
}

/**
 * Resolved custom-method config with all defaults applied.
 * @internal
 */
export interface ResolvedCustomMethods {
  /** Whether any custom-method instrumentation is active at all. */
  enabled: boolean;
  statics: MethodSelector;
  methods: MethodSelector;
  query: MethodSelector;
  /**
   * Resolved parameter capture function, or `false` when disabled.
   * Receives the raw argument list and returns the redacted, length-capped
   * string for `mongoose.method.parameters` (or `undefined` to omit it).
   */
  captureParameters:
    | false
    | ((
        args: readonly unknown[],
        context: { methodName: string; methodType: CustomMethodType },
      ) => string | undefined);
}

/**
 * Resolved config with all defaults applied.
 * @internal
 */
export interface ResolvedConfig {
  dbName: string;
  peerName: string;
  peerPort: number;
  tracerName: string;
  captureCollectionName: boolean;
  instrumentHooks: boolean;
  dbStatementSerializer:
    | ((operation: string, payload: SerializerPayload) => string | undefined)
    | false;
  statementRedactor: AttributeRedactorPreset | AttributeRedactorConfig | false;
  customMethods: ResolvedCustomMethods;
}

export const DEFAULT_TRACER_NAME = 'autotel-mongoose';
