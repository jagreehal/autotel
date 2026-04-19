import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getCollectorComponentReadme,
  getCollectorComponentSchema,
  listCollectorComponents,
  listCollectorVersions,
  refreshCollectorCatalog,
  resolveCollectorVersion,
  validateCollectorComponentConfig,
} from '../modules/collector-catalog';
import { respondSafe } from './shared';

const componentKindSchema = z.enum([
  'receiver',
  'processor',
  'exporter',
  'connector',
  'extension',
]);

export function registerCollectorSchemaTools(server: McpServer): void {
  server.registerTool(
    'collector_get_versions',
    {
      description:
        'List available OpenTelemetry Collector schema versions supported by the upstream catalog.',
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(async () => ({ versions: await listCollectorVersions() })),
  );

  server.registerTool(
    'collector_list_components',
    {
      description:
        'List collector components (receivers/processors/exporters/connectors/extensions) for a given version.',
      inputSchema: z.object({
        version: z
          .string()
          .regex(/^\d+\.\d+\.\d+$/)
          .optional(),
        kind: componentKindSchema.optional(),
      }),
    },
    async ({ version, kind }) =>
      respondSafe(async () => {
        const resolvedVersion = await resolveCollectorVersion(version);
        const components = await listCollectorComponents(resolvedVersion);
        if (kind) {
          return {
            version: resolvedVersion,
            kind,
            components: components[kind],
          };
        }
        return {
          version: resolvedVersion,
          components,
        };
      }),
  );

  server.registerTool(
    'collector_component_schema',
    {
      description: 'Get JSON Schema for a collector component configuration.',
      inputSchema: z.object({
        version: z
          .string()
          .regex(/^\d+\.\d+\.\d+$/)
          .optional(),
        kind: componentKindSchema,
        name: z.string().min(1),
      }),
    },
    async ({ version, kind, name }) =>
      respondSafe(async () => {
        const resolvedVersion = await resolveCollectorVersion(version);
        const schema = await getCollectorComponentSchema(
          kind,
          name,
          resolvedVersion,
        );
        return {
          version: resolvedVersion,
          kind,
          name,
          schema,
        };
      }),
  );

  server.registerTool(
    'collector_component_readme',
    {
      description: 'Get README/reference text for a collector component.',
      inputSchema: z.object({
        version: z
          .string()
          .regex(/^\d+\.\d+\.\d+$/)
          .optional(),
        kind: componentKindSchema,
        name: z.string().min(1),
      }),
    },
    async ({ version, kind, name }) =>
      respondSafe(async () => {
        const resolvedVersion = await resolveCollectorVersion(version);
        const readme = await getCollectorComponentReadme(
          kind,
          name,
          resolvedVersion,
        );
        return {
          version: resolvedVersion,
          kind,
          name,
          readme,
        };
      }),
  );

  server.registerTool(
    'collector_validate_component_config',
    {
      description:
        'Validate collector component config against the versioned upstream JSON schema.',
      inputSchema: z.object({
        version: z
          .string()
          .regex(/^\d+\.\d+\.\d+$/)
          .optional(),
        kind: componentKindSchema,
        name: z.string().min(1),
        config: z.any(),
      }),
    },
    async ({ version, kind, name, config }) =>
      respondSafe(async () => {
        const resolvedVersion = await resolveCollectorVersion(version);
        const result = await validateCollectorComponentConfig({
          kind,
          name,
          version: resolvedVersion,
          config,
        });
        return {
          version: resolvedVersion,
          kind,
          name,
          ...result,
        };
      }),
  );

  server.registerTool(
    'collector_refresh_catalog',
    {
      description:
        'Refresh local in-memory collector metadata cache from upstream GitHub catalog.',
      inputSchema: z.object({}),
    },
    async () => respondSafe(async () => refreshCollectorCatalog()),
  );
}
