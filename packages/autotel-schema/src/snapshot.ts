/**
 * Snapshots — the serializable form of a contract that gets committed and
 * diffed across versions. Checking a snapshot into the repo turns "did this
 * refactor rename a span?" into a reviewable line in a PR instead of a silent
 * break the agent reader discovers at 3am.
 */

import { SNAPSHOT_SPEC } from './attrs.js';
import type {
  AttributeSpec,
  AttributeType,
  Stability,
  TelemetryContract,
} from './contract.js';

/** Flattened, fully-resolved attribute record in a snapshot. */
export interface SnapshotAttribute {
  type: AttributeType;
  stability: Stability;
  required: boolean;
  highCardinality: boolean;
  enum?: readonly (string | number)[];
  replacedBy?: string;
  description?: string;
}

export interface SnapshotSpan {
  stability: Stability;
  additionalAttributes: boolean;
  description?: string;
  attributes: Record<string, SnapshotAttribute>;
}

/** Canonical, comparable representation of a {@link TelemetryContract}. */
export interface ContractSnapshot {
  spec: typeof SNAPSHOT_SPEC;
  service: string;
  version: string;
  commonAttributes: Record<string, SnapshotAttribute>;
  spans: Record<string, SnapshotSpan>;
}

function normalizeAttribute(spec: AttributeSpec): SnapshotAttribute {
  const out: SnapshotAttribute = {
    type: spec.type,
    stability: spec.stability ?? 'stable',
    required: spec.required ?? false,
    highCardinality: spec.highCardinality ?? false,
  };
  if (spec.enum) out.enum = [...spec.enum];
  if (spec.replacedBy) out.replacedBy = spec.replacedBy;
  if (spec.description) out.description = spec.description;
  return out;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).toSorted()) {
    out[key] = record[key];
  }
  return out;
}

/**
 * Produce a deterministic, JSON-serializable snapshot from a contract. Keys are
 * sorted so two snapshots of the same logical contract are byte-identical —
 * important for clean `git diff`s and stable CI comparisons.
 */
export function contractToSnapshot(
  contract: TelemetryContract,
): ContractSnapshot {
  const commonAttributes: Record<string, SnapshotAttribute> = {};
  for (const [key, spec] of Object.entries(contract.commonAttributes ?? {})) {
    commonAttributes[key] = normalizeAttribute(spec);
  }

  const spans: Record<string, SnapshotSpan> = {};
  for (const [name, spanSpec] of Object.entries(contract.spans)) {
    const attributes: Record<string, SnapshotAttribute> = {};
    for (const [key, spec] of Object.entries(spanSpec.attributes ?? {})) {
      attributes[key] = normalizeAttribute(spec);
    }
    const span: SnapshotSpan = {
      stability: spanSpec.stability ?? 'stable',
      additionalAttributes:
        spanSpec.additionalAttributes ?? contract.additionalAttributes ?? false,
      attributes: sortRecord(attributes),
    };
    if (spanSpec.description) span.description = spanSpec.description;
    spans[name] = span;
  }

  return {
    spec: SNAPSHOT_SPEC,
    service: contract.service,
    version: contract.version,
    commonAttributes: sortRecord(commonAttributes),
    spans: sortRecord(spans),
  };
}

/** Pretty, deterministic JSON for writing a snapshot to disk. */
export function serializeSnapshot(snapshot: ContractSnapshot): string {
  return JSON.stringify(snapshot, null, 2) + '\n';
}

/** Parse and structurally validate a snapshot read from disk. */
export function parseSnapshot(json: string): ContractSnapshot {
  const data = JSON.parse(json) as ContractSnapshot;
  if (data.spec !== SNAPSHOT_SPEC) {
    throw new Error(
      `autotel-schema: unexpected snapshot spec "${data.spec}" (expected "${SNAPSHOT_SPEC}")`,
    );
  }
  if (typeof data.service !== 'string' || typeof data.version !== 'string') {
    throw new Error('autotel-schema: snapshot is missing service/version');
  }
  return data;
}
