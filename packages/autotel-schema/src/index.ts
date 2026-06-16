/**
 * autotel-schema — your telemetry surface as a typed, versioned contract.
 *
 * When the primary reader of your telemetry is an agent, your span names and
 * attribute keys are a **public API**. `defineContract()` makes that surface
 * explicit and versionable; `validateSpan` / `SchemaValidationSpanProcessor`
 * check live spans against it; `diffSnapshots` / `hasBreakingChanges` catch
 * breaking trace-surface changes before they ship; `highCardinalityKeys` feeds
 * a redaction allow-list so the fields most useful to an agent reader survive.
 *
 * The contract model is dependency-free and side-effect-free — safe to import
 * anywhere (browser, edge, CLI) without pulling in the OpenTelemetry SDK.
 */

export {
  SCHEMA_ATTRS,
  SNAPSHOT_SPEC,
} from './attrs.js';
export type { SchemaAttributeKey } from './attrs.js';

export {
  ATTRIBUTE_TYPES,
  STABILITIES,
  defineContract,
  resolveAttributeSpec,
  allowsAdditionalAttributes,
} from './contract.js';
export type {
  AttributeType,
  Stability,
  AttributeSpec,
  SpanSpec,
  TelemetryContract,
} from './contract.js';

export {
  contractToSnapshot,
  serializeSnapshot,
  parseSnapshot,
} from './snapshot.js';
export type {
  SnapshotAttribute,
  SnapshotSpan,
  ContractSnapshot,
} from './snapshot.js';

export {
  validateSpan,
  hasErrors,
  formatViolation,
} from './validate.js';
export type {
  ViolationSeverity,
  ViolationCode,
  SchemaViolation,
  SpanShape,
  ValidateOptions,
} from './validate.js';

export {
  SchemaValidationSpanProcessor,
  createSchemaValidationProcessor,
} from './processor.js';
export type {
  ReadableSpanLike,
  SpanLike,
  OtelContext,
  SpanProcessorLike,
  SchemaProcessorMode,
  SchemaValidationProcessorOptions,
} from './processor.js';

export {
  diffSnapshots,
  hasBreakingChanges,
  formatDiff,
} from './diff.js';
export type {
  ChangeKind,
  ChangeType,
  SnapshotChange,
  SnapshotDiff,
} from './diff.js';

export {
  highCardinalityKeys,
  isHighCardinalityKey,
} from './redaction.js';
