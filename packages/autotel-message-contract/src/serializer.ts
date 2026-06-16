/**
 * Message serializers.
 *
 * A contract pins the bytes a message becomes *once serialized* — the exact
 * shape a consumer, a queue, or a stored event reads. The only way that
 * snapshot is meaningful is if it is produced by the **same serializer your
 * application ships with**. Pin a shape your consumers never see and you have
 * pinned nothing.
 *
 * So a {@link MessageSerializer} is a tiny, explicit seam: `serialize` /
 * `deserialize`. The default is JSON with deterministic key ordering (so a
 * snapshot does not churn when object construction order changes), but you are
 * encouraged to pass your app's real serializer — `superjson`, `devalue`, a
 * snake_case Jackson-equivalent, a protobuf codec — so the snapshot records the
 * exact bytes you put on the wire.
 */

/** A reversible mapping between an in-memory value and its serialized form. */
export interface MessageSerializer<Serialized = string> {
  /** Human-facing name, surfaced in snapshot headers and failure messages. */
  readonly name: string;
  /** Turn a value into its serialized form (the bytes you ship). */
  serialize(value: unknown): Serialized;
  /** Turn a serialized form back into a value. */
  deserialize(serialized: Serialized): unknown;
}

/**
 * Recursively sort object keys so two values with the same fields serialize
 * identically regardless of insertion order. Arrays keep their order (it is
 * semantically meaningful); plain objects are reordered; class instances,
 * Maps, Sets, Dates, etc. are left untouched so the serializer can decide.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((element) => sortKeysDeep(element));
  }
  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export interface JsonSerializerOptions {
  /**
   * Pretty-print with this indent. Defaults to `2` so the approved file reads
   * cleanly in a diff. Set to `0` to pin the compact bytes you actually ship.
   */
  indent?: number;
  /**
   * Sort object keys deterministically before serializing. Defaults to `true`
   * so a snapshot reflects *fields*, not construction order. Turn it off when
   * key order is itself part of the contract.
   */
  sortKeys?: boolean;
}

/**
 * The default serializer: `JSON.stringify` with deterministic key ordering.
 * Good enough to pin most events and commands; swap it for your own when the
 * bytes you ship differ (custom date formats, snake_case, omitted nulls…).
 */
export function jsonSerializer(
  options: JsonSerializerOptions = {},
): MessageSerializer<string> {
  const { indent = 2, sortKeys = true } = options;
  return {
    name: sortKeys ? 'json' : 'json (key-order preserved)',
    serialize(value) {
      const prepared = sortKeys ? sortKeysDeep(value) : value;
      return JSON.stringify(prepared, undefined, indent);
    },
    deserialize(serialized) {
      return JSON.parse(serialized) as unknown;
    },
  };
}

/** The serializer used when a contract does not specify one. */
export const defaultSerializer: MessageSerializer<string> = jsonSerializer();
