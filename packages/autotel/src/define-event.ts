import { createHash } from 'node:crypto';
import { track } from './track';
import type { EventSchemaMetadata } from './event-subscriber';

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: unknown };

export interface SchemaLike<T> {
  safeParse(input: unknown): SafeParseResult<T>;
}

export interface DefineEventOptions<S> {
  toJsonSchema?: (schema: S) => unknown;
}

export interface DefinedEvent<Name extends string, Payload> {
  readonly name: Name;
  readonly schemaMetadata?: EventSchemaMetadata;
  track(payload: Payload): void;
}

export function defineEvent<
  Name extends string,
  Payload,
  S extends SchemaLike<Payload>,
>(
  name: Name,
  schema: S,
  options: DefineEventOptions<S> = {},
): DefinedEvent<Name, Payload> {
  const jsonSchema = options.toJsonSchema?.(schema);
  const schemaMetadata = jsonSchema
    ? {
        source: 'zod' as const,
        jsonSchema,
        hash: hashSchema(jsonSchema),
      }
    : undefined;

  return {
    name,
    schemaMetadata,
    track(payload: Payload) {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          `Invalid payload for event "${name}". Schema validation failed.`,
        );
      }
      track(
        name,
        parsed.data,
        schemaMetadata ? { schema: schemaMetadata } : undefined,
      );
    },
  };
}

function hashSchema(schema: unknown): string {
  return createHash('sha256').update(stableStringify(schema)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
    .join(',');
  return '{' + body + '}';
}
