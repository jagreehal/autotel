/**
 * Readers — the "as this version" side of a compatibility check.
 *
 * In a JVM contract library you write `whenDeserializedAs(NewType.class)` and
 * reflection does the rest. TypeScript types are erased at runtime, so there is
 * no class to hand over. Instead you describe the *reader*: the thing that
 * accepts a deserialized value and either produces a typed result or rejects
 * it. Two shapes are accepted, in order of how most TS codebases already model
 * a message version:
 *
 *  1. A **Standard Schema** (Zod ≥3.24, Valibot, ArkType, …) — anything exposing
 *     the `~standard` interface. This is the recommended form: the schema is the
 *     version, and it already lives next to your message type.
 *  2. A plain **parse function** `(value) => T` that throws on incompatible input.
 *
 * A reader that accepts the value proves compatibility; a reader that throws or
 * reports issues proves the versions have drifted apart.
 */

/** The subset of the Standard Schema v1 interface we rely on. */
export interface StandardSchemaLike<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
  };
}

/** Where in the message an issue was found, as Standard Schema reports it. */
export type IssuePath = ReadonlyArray<PropertyKey | { key: PropertyKey }>;

interface StandardResult<Output> {
  value?: Output;
  issues?: ReadonlyArray<{
    readonly message: string;
    readonly path?: IssuePath;
  }>;
}

/** A bare parse function: returns the typed value or throws. */
export type ParseFn<Output = unknown> = (value: unknown) => Output;

/** Either accepted reader form. */
export type Reader<Output = unknown> =
  StandardSchemaLike<Output> | ParseFn<Output>;

function isStandardSchema(reader: Reader): reader is StandardSchemaLike {
  // SAFETY: a Reader is either a parse function or a Standard Schema object.
  // The `in` check below is what distinguishes them, and the assertion only
  // reads the property that check just established.
  return (
    reader instanceof Object &&
    '~standard' in reader &&
    (reader as StandardSchemaLike)['~standard']?.validate !== undefined
  );
}

export interface ReadOutcome<Output = unknown> {
  ok: boolean;
  /** Present when `ok`. */
  value?: Output;
  /** Human-readable reasons the reader rejected the value. */
  issues: string[];
}

/**
 * Run a reader against a deserialized value. Never throws — a thrown parse
 * error or reported issues become `{ ok: false, issues }` so the caller can
 * build a single, legible failure message.
 */
export async function read<Output>(
  reader: Reader<Output>,
  value: unknown,
): Promise<ReadOutcome<Output>> {
  if (isStandardSchema(reader)) {
    try {
      const result = await reader['~standard'].validate(value);
      if (result.issues && result.issues.length > 0) {
        return {
          ok: false,
          issues: result.issues.map((issue) =>
            formatIssue(issue.message, issue.path),
          ),
        };
      }
      // SAFETY: a Standard Schema result with no issues carries the parsed value,
      // typed by the schema this reader was built from.
      return { ok: true, value: result.value as Output, issues: [] };
    } catch (error) {
      return { ok: false, issues: [errorMessage(error)] };
    }
  }

  try {
    // SAFETY: isStandardSchema returned false above, and a Reader is one of the
    // two; the remaining case is the parse function.
    const parsed = (reader as ParseFn<Output>)(value);
    return { ok: true, value: parsed, issues: [] };
  } catch (error) {
    return { ok: false, issues: [errorMessage(error)] };
  }
}

function formatIssue(message: string, path: IssuePath | undefined): string {
  if (Array.isArray(path) && path.length > 0) {
    return `${path.map(String).join('.')}: ${message}`;
  }
  return message;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
