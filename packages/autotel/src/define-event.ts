import { track } from './track';
import { hashJson } from './stable-hash';
import type { EventSchemaMetadata } from './event-subscriber';

type SafeParseResult<T> =
  { success: true; data: T } | { success: false; error: unknown };

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
        hash: hashJson(jsonSchema),
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
