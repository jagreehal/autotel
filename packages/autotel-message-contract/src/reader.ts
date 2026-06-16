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
    readonly validate: (value: unknown) =>
      | StandardResult<Output>
      | Promise<StandardResult<Output>>;
  };
}

interface StandardResult<Output> {
  value?: Output;
  issues?: ReadonlyArray<{ readonly message: string; readonly path?: unknown }>;
}

/** A bare parse function: returns the typed value or throws. */
export type ParseFn<Output = unknown> = (value: unknown) => Output;

/** Either accepted reader form. */
export type Reader<Output = unknown> =
  | StandardSchemaLike<Output>
  | ParseFn<Output>;

function isStandardSchema(reader: Reader): reader is StandardSchemaLike {
  return (
    typeof reader === 'object' &&
    reader !== null &&
    '~standard' in reader &&
    typeof (reader as StandardSchemaLike)['~standard']?.validate === 'function'
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
          issues: result.issues.map(
            (issue) => formatIssue(issue.message, issue.path),
          ),
        };
      }
      return { ok: true, value: result.value as Output, issues: [] };
    } catch (error) {
      return { ok: false, issues: [errorMessage(error)] };
    }
  }

  try {
    const parsed = (reader as ParseFn<Output>)(value);
    return { ok: true, value: parsed, issues: [] };
  } catch (error) {
    return { ok: false, issues: [errorMessage(error)] };
  }
}

function formatIssue(message: string, path: unknown): string {
  if (Array.isArray(path) && path.length > 0) {
    return `${path.map(String).join('.')}: ${message}`;
  }
  return message;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
