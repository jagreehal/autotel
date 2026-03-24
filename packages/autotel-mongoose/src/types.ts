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
}

export const DEFAULT_TRACER_NAME = 'autotel-mongoose';
