/**
 * The message contract DSL.
 *
 * Every check starts from {@link messageContract} and reads as a sentence:
 *
 * ```ts
 * // Pin the serialized shape — fail when it drifts.
 * await messageContract()
 *   .given(new OrderPlaced(orderId, 'Alice', placedAt))
 *   .whenSerialized()
 *   .thenContractIsUnchanged();
 *
 * // Prove a newer reader still reads what an older writer produced.
 * await messageContract()
 *   .given(orderPlacedV1)
 *   .whenDeserializedAs(OrderPlacedV2)   // a Zod schema or parse fn
 *   .thenBackwardCompatible((v2) => expect(v2.coupon).toBeUndefined());
 * ```
 *
 * A **snapshot check** confirms a message still serializes exactly as approved,
 * so nothing reading it downstream breaks. A **compatibility check** confirms an
 * older and a newer version can still read each other's data. Both are ordinary
 * unit tests — no broker, no registry, no running service.
 */
import { lineDiff } from './diff.js';
import { read, type Reader } from './reader.js';
import {
  defaultSerializer,
  type MessageSerializer,
} from './serializer.js';
import {
  isUpdateMode,
  readSnapshot,
  type SnapshotLocation,
  writeSnapshot,
} from './snapshot-storage.js';

/** Thrown when a contract check fails. Message is pre-formatted for a test runner. */
export class ContractViolationError extends Error {
  override readonly name = 'ContractViolationError';
  constructor(message: string) {
    super(message);
  }
}

export interface MessageContractOptions {
  /** Serializer producing the bytes you ship. Defaults to deterministic JSON. */
  serializer?: MessageSerializer<string>;
  /**
   * Where approved files live and what they are named. A bare string is used as
   * the logical name; an object gives full control over `dir`/`path`.
   */
  snapshot?: string | SnapshotLocation;
  /** Override update-mode detection (default reads env, e.g. AUTOTEL_CONTRACT_UPDATE=1). */
  update?: boolean;
}

const SNAPSHOT_SOURCE = Symbol('autotel-message-contract.snapshot-source');

export interface ApprovedSnapshotSource {
  readonly [SNAPSHOT_SOURCE]: true;
  readonly location?: string | SnapshotLocation;
}

/**
 * Point a compatibility check at a previously approved snapshot instead of a
 * live in-memory message instance.
 */
export function approvedSnapshot(
  location?: string | SnapshotLocation,
): ApprovedSnapshotSource {
  return {
    [SNAPSHOT_SOURCE]: true,
    location,
  };
}

function isApprovedSnapshotSource(value: unknown): value is ApprovedSnapshotSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    SNAPSHOT_SOURCE in value &&
    (value as ApprovedSnapshotSource)[SNAPSHOT_SOURCE] === true
  );
}

/** Start a contract check. */
export function messageContract(options: MessageContractOptions = {}): GivenStep {
  return new GivenStep(options);
}

class GivenStep {
  constructor(private readonly options: MessageContractOptions) {}

  /** The message under contract. */
  given<T>(message: T | ApprovedSnapshotSource): WhenStep<T> {
    return new WhenStep(message, this.options);
  }
}

class WhenStep<T> {
  constructor(
    private readonly message: T | ApprovedSnapshotSource,
    private readonly options: MessageContractOptions,
  ) {}

  /** Serialize the message; the next step pins or inspects the result. */
  whenSerialized(): SnapshotStep {
    if (isApprovedSnapshotSource(this.message)) {
      throw new ContractViolationError(
        'Cannot serialize an approved snapshot source. ' +
          'Use .whenDeserializedAs(...) to run a compatibility check, or ' +
          'pass a live message instance to .given(...).',
      );
    }
    const serializer = this.options.serializer ?? defaultSerializer;
    const serialized = serializer.serialize(this.message);
    return new SnapshotStep(serialized, serializer, this.options);
  }

  /**
   * Round-trip the message through a reader that models a *different version*
   * (a Standard Schema such as Zod/Valibot, or a parse function). The next step
   * asserts the versions stay compatible.
   */
  whenDeserializedAs<Output>(reader: Reader<Output>): CompatibilityStep<Output> {
    const serializer = this.options.serializer ?? defaultSerializer;
    return new CompatibilityStep(this.message, reader, serializer, this.options);
  }
}

class SnapshotStep {
  constructor(
    private readonly serialized: string,
    private readonly serializer: MessageSerializer<string>,
    private readonly options: MessageContractOptions,
  ) {}

  /** The serialized bytes, for ad-hoc assertions outside the snapshot flow. */
  get output(): string {
    return this.serialized;
  }

  /**
   * Compare the serialized output against the approved snapshot. On first run
   * (or in update mode) it writes the approved file and passes; afterwards it
   * fails with a diff when the shape drifts.
   */
  thenContractIsUnchanged(snapshotName?: string): void {
    const location = this.resolveLocation(snapshotName);
    const existing = readSnapshot(location);
    const update = this.options.update ?? isUpdateMode();

    if (!existing.exists || update) {
      const path = writeSnapshot(location, this.serialized);
      if (!existing.exists) {
        // First run: record and pass, leaving the file to be reviewed/committed.
        return;
      }
      // Update mode: rewrite and pass even if it changed.
      void path;
      return;
    }

    if (existing.content !== this.serialized) {
      throw new ContractViolationError(
        `Message contract drifted from its approved snapshot.\n` +
          `  serializer: ${this.serializer.name}\n` +
          `  snapshot:   ${existing.path}\n\n` +
          `${lineDiff(existing.content ?? '', this.serialized)}\n\n` +
          `If this change is intentional, re-run with AUTOTEL_CONTRACT_UPDATE=1 ` +
          `to update the approved file, then review and commit it.`,
      );
    }
  }

  private resolveLocation(snapshotName?: string): SnapshotLocation {
    if (snapshotName) return { name: snapshotName };
    const configured = this.options.snapshot;
    if (typeof configured === 'string') return { name: configured };
    if (configured) return configured;
    throw new ContractViolationError(
      `A snapshot name is required. Pass one to messageContract({ snapshot: 'OrderPlaced' }) ` +
        `or to thenContractIsUnchanged('OrderPlaced').`,
    );
  }
}

class CompatibilityStep<Output> {
  constructor(
    private readonly source: unknown,
    private readonly reader: Reader<Output>,
    private readonly serializer: MessageSerializer<string>,
    private readonly options: MessageContractOptions,
  ) {}

  /**
   * The reader models a **newer** version; confirm it still reads what an older
   * writer produced (stored events, in-flight messages). Optionally assert on
   * the upgraded value — e.g. that a newly-added field defaults sensibly.
   */
  async thenBackwardCompatible(
    assert?: (value: Output) => void | Promise<void>,
  ): Promise<Output> {
    return this.check('backward', assert);
  }

  /**
   * The reader models an **older** version; confirm a consumer that has not
   * upgraded yet still reads what the newer writer produces, so you can ship the
   * new shape before every reader has caught up.
   */
  async thenForwardCompatible(
    assert?: (value: Output) => void | Promise<void>,
  ): Promise<Output> {
    return this.check('forward', assert);
  }

  private async check(
    direction: 'backward' | 'forward',
    assert?: (value: Output) => void | Promise<void>,
  ): Promise<Output> {
    const serialized = this.resolveSourceSerialized();
    const deserializedSource = this.serializer.deserialize(serialized);
    const outcome = await read(this.reader, deserializedSource);

    if (!outcome.ok) {
      const writer = direction === 'backward' ? 'an older writer' : 'a newer writer';
      const readerLabel =
        direction === 'backward' ? 'the newer reader' : 'the older reader';
      throw new ContractViolationError(
        `Not ${direction}-compatible: ${readerLabel} rejected a message ${writer} produced.\n` +
          `  serializer: ${this.serializer.name}\n` +
          `  serialized: ${truncate(serialized)}\n` +
          `  issues:\n${outcome.issues.map((m) => `    - ${m}`).join('\n')}`,
      );
    }

    this.assertStructuralCompatibility(
      deserializedSource,
      this.serializer.deserialize(this.serializer.serialize(outcome.value)),
      direction,
      serialized,
    );

    if (assert) await assert(outcome.value as Output);
    return outcome.value as Output;
  }

  private resolveSourceSerialized(): string {
    if (isApprovedSnapshotSource(this.source)) {
      const location = this.resolveSnapshotLocation(this.source.location);
      const existing = readSnapshot(location);
      if (!existing.exists || existing.content === undefined) {
        throw new ContractViolationError(
          `Cannot read approved snapshot for compatibility check.\n` +
            `  snapshot: ${existing.path}\n\n` +
            `Record it first with .whenSerialized().thenContractIsUnchanged(), ` +
            `or point approvedSnapshot(...) at an existing file.`,
        );
      }
      return existing.content;
    }
    return this.serializer.serialize(this.source);
  }

  private resolveSnapshotLocation(
    location?: string | SnapshotLocation,
  ): SnapshotLocation {
    if (typeof location === 'string') return { name: location };
    if (location) return location;

    const configured = this.options.snapshot;
    if (typeof configured === 'string') return { name: configured };
    if (configured) return configured;

    throw new ContractViolationError(
      'A snapshot location is required for approvedSnapshot(). ' +
        `Pass approvedSnapshot('OrderPlaced_v1') or configure messageContract({ snapshot: 'OrderPlaced_v1' }).`,
    );
  }

  private assertStructuralCompatibility(
    sourceValue: unknown,
    targetValue: unknown,
    direction: 'backward' | 'forward',
    serialized: string,
  ): void {
    const mismatches: string[] = [];
    compareSharedStructure(sourceValue, targetValue, '$', mismatches);

    if (mismatches.length === 0) return;

    throw new ContractViolationError(
      `Not ${direction}-compatible: shared fields changed meaning across versions.\n` +
        `  serializer: ${this.serializer.name}\n` +
        `  serialized: ${truncate(serialized)}\n` +
        `  mismatches:\n${mismatches.map((issue) => `    - ${issue}`).join('\n')}`,
    );
  }
}

function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}… (${value.length} chars)` : value;
}

function compareSharedStructure(
  sourceValue: unknown,
  targetValue: unknown,
  path: string,
  mismatches: string[],
): void {
  if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
    const sourceKeys = Object.keys(sourceValue);
    const targetKeys = Object.keys(targetValue);
    const sourceOnly = sourceKeys.filter((key) => !(key in targetValue));
    const targetOnly = targetKeys.filter((key) => !(key in sourceValue));

    if (sourceOnly.length > 0 && targetOnly.length > 0) {
      mismatches.push(
        `${path}: structural incompatibility ` +
          `[source-only: ${sourceOnly.join(', ')}, target-only: ${targetOnly.join(', ')}]`,
      );
      return;
    }

    for (const key of sourceKeys.filter((candidate) => candidate in targetValue).toSorted()) {
      compareSharedStructure(
        sourceValue[key],
        targetValue[key],
        joinPath(path, key),
        mismatches,
      );
    }
    return;
  }

  if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
    if (sourceValue.length !== targetValue.length) {
      mismatches.push(
        `${path}: array length differs (${sourceValue.length} vs ${targetValue.length})`,
      );
      return;
    }

    for (const [index, sourceItem] of sourceValue.entries()) {
      compareSharedStructure(sourceItem, targetValue[index], `${path}[${index}]`, mismatches);
    }
    return;
  }

  if (!deepEqual(sourceValue, targetValue)) {
    mismatches.push(
      `${path}: value differs (${formatValue(sourceValue)} vs ${formatValue(targetValue)})`,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => key in right && deepEqual(left[key], right[key]))
    );
  }

  return false;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function joinPath(path: string, key: string): string {
  return path === '$' ? `$.${key}` : `${path}.${key}`;
}

export type {
  GivenStep,
  WhenStep,
  SnapshotStep,
  CompatibilityStep,
};
