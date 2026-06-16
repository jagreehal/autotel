/**
 * Wire constants for the schema contract — the keys autotel-schema reads from
 * and stamps onto spans. Dependency-free so CLI, browser, and edge code can
 * share the exact same strings the runtime uses.
 */

/**
 * Resource/span attributes that announce the contract to a reader. Stamping
 * `telemetry.schema.version` means an agent following a trace knows *which*
 * version of your public telemetry API it is looking at — the difference
 * between "confidently correct" and "confidently wrong" after a rename.
 */
export const SCHEMA_ATTRS = {
  /** The service this contract describes (mirrors `service.name`). */
  SERVICE: 'telemetry.schema.service',
  /** Semver of the telemetry contract that produced this span. */
  VERSION: 'telemetry.schema.version',
} as const;

export type SchemaAttributeKey = (typeof SCHEMA_ATTRS)[keyof typeof SCHEMA_ATTRS];

/** Snapshot file spec marker — bump only on a breaking snapshot format change. */
export const SNAPSHOT_SPEC = 'autotel-schema-snapshot/v1' as const;
