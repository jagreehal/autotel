// Read the current state of an EventCatalog using @eventcatalog/sdk. We
// re-use SDK types (`Event`, `Service`, `Channel`) verbatim and only add the
// two fields the SDK doesn't expose: the resolved on-disk `filePath`, and the
// dotted field-path + schema-constraint extractions our drift diff consumes.
// Inventing our own catalog types would silently drift from the SDK as it
// evolves.

import type { JsonSchemaNode } from './generate.js';
import utils from '@eventcatalog/sdk';
import type { Channel, Event, Service } from '@eventcatalog/sdk';

export type SchemaConstraint = {
  types?: string[];
  enumValues?: unknown[];
};

export type CatalogEvent = Event & {
  /** Absolute path to the event's `index.mdx`, resolved via SDK. */
  filePath: string;
  /** Field paths declared in the event's JSON Schema (if present). */
  declaredFieldPaths?: string[];
  declaredSchemaConstraints?: Record<string, SchemaConstraint>;
};

export type CatalogService = Service & {
  filePath: string;
};

export type CatalogChannel = Channel & {
  filePath: string;
};

export type CatalogState = {
  events: Map<string, CatalogEvent>;
  services: Map<string, CatalogService>;
  channels: Map<string, CatalogChannel>;
};

export async function readCatalogState(
  catalogPath: string,
): Promise<CatalogState> {
  const sdk = utils(catalogPath);

  const [events, services, channels] = await Promise.all([
    sdk.getEvents({ latestOnly: true, attachSchema: true }),
    sdk.getServices({ latestOnly: true }),
    sdk.getChannels({ latestOnly: true }),
  ]);

  const state: CatalogState = {
    events: new Map(),
    services: new Map(),
    channels: new Map(),
  };

  // SDK quirk (as of 2.21.2): unlike the other helpers, `getResourcePath` is
  // not curried with `catalogDir`, so we pass the catalog path explicitly.
  const resolveFilePath = async (id: string, version?: string) => {
    const paths = await sdk.getResourcePath(catalogPath, id, version);
    return paths?.fullPath ?? '';
  };

  for (const e of events ?? []) {
    const filePath = await resolveFilePath(e.id, e.version);
    const schemaExtractions = e.schema
      ? {
          declaredFieldPaths: extractDeclaredFieldPaths(e.schema),
          declaredSchemaConstraints: extractDeclaredSchemaConstraints(e.schema),
        }
      : {};
    state.events.set(e.id, { ...e, filePath, ...schemaExtractions });
  }

  for (const s of services ?? []) {
    const filePath = await resolveFilePath(s.id, s.version);
    state.services.set(s.id, { ...s, filePath });
  }

  for (const c of channels ?? []) {
    const filePath = await resolveFilePath(c.id, c.version);
    state.channels.set(c.id, { ...c, filePath });
  }

  return state;
}

/**
 * Extract field paths from a JSON Schema. Mirrors the dotted-path convention
 * used by the snapshot subscriber: arrays collapse to `[]`, nested objects
 * use `.`. We walk `properties` (objects) and `items` (arrays).
 */
export function extractDeclaredFieldPaths(
  schema: JsonSchemaNode | undefined,
  prefix = '',
): string[] {
  const out = new Set<string>();
  walkSchema(schema, prefix, out);
  return [...out].toSorted();
}

function walkSchema(
  schema: JsonSchemaNode | undefined,
  prefix: string,
  out: Set<string>,
): void {
  if (!schema) return;

  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    out.add(path);
    walkSchema(sub, path, out);
  }

  if (schema.items) walkSchema(schema.items, prefix + '[]', out);
}

export function extractDeclaredSchemaConstraints(
  schema: JsonSchemaNode | undefined,
  prefix = '',
): Record<string, SchemaConstraint> {
  const out = new Map<string, SchemaConstraint>();
  walkSchemaConstraints(schema, prefix, out);
  return Object.fromEntries(out);
}

function walkSchemaConstraints(
  schema: JsonSchemaNode | undefined,
  prefix: string,
  out: Map<string, SchemaConstraint>,
): void {
  if (!schema) return;
  const typeVal = schema.type;
  const enumVal = schema.enum;
  if (prefix !== '' && (typeVal !== undefined || enumVal !== undefined)) {
    const types = toTypeArray(typeVal);
    const enumValues = Array.isArray(enumVal) ? [...enumVal] : undefined;
    // A field declares types, enum values, both or neither; an absent one is
    // omitted rather than recorded as empty.
    const field: SchemaConstraint = {};
    if (types.length > 0) field.types = types;
    if (enumValues) field.enumValues = enumValues;
    out.set(prefix, field);
  }

  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    walkSchemaConstraints(sub, path, out);
  }
  if (schema.items) {
    const arrayPrefix = prefix + '[]';
    walkSchemaConstraints(schema.items, arrayPrefix, out);
  }
}

function toTypeArray(typeVal: JsonSchemaNode['type']): string[] {
  if (typeof typeVal === 'string') return [typeVal];
  if (Array.isArray(typeVal)) {
    return typeVal.filter((t): t is string => typeof t === 'string').toSorted();
  }
  return [];
}
