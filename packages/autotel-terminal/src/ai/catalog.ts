import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/ink/schema';
import {
  standardComponentDefinitions,
  standardActionDefinitions,
} from '@json-render/ink/catalog';

/**
 * Catalog with all standard Ink components.
 * The system prompt restricts the AI to the telemetry-relevant ones
 * (Table, KeyValue, Badge, BarChart, Text, Box, Heading, Divider, Card).
 */
export const catalog = defineCatalog(schema, {
  components: standardComponentDefinitions,
  actions: standardActionDefinitions,
});
