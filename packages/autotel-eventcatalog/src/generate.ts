import utils from '@eventcatalog/sdk';
import { readCatalogState } from './catalog';
import type { ArchitectureSnapshot, EventObservation } from './snapshot';

export interface GenerateOptions {
  snapshot: ArchitectureSnapshot;
  catalogPath: string;
  dryRun?: boolean;
  edgesOnly?: boolean;
  /** Version to assign to newly created resources. Defaults to '1.0.0'. */
  version?: string;
}

export type GenerateSummaryItem = {
  kind: 'service' | 'event' | 'channel' | 'service-edge' | 'channel-edge';
  id: string;
  action: 'create' | 'exists' | 'link' | 'would-create' | 'would-link';
  detail?: string;
  /** For event items: where the JSON Schema came from. */
  schemaSource?: 'declared' | 'inferred';
};

export interface GenerateResult {
  operations: GenerateSummaryItem[];
}

export const GENERATE_SUMMARY_SPEC =
  'autotel-eventcatalog-generate-summary/v0.1.0' as const;

export type GenerateSummary = {
  spec: typeof GENERATE_SUMMARY_SPEC;
  dryRun: boolean;
  edgesOnly: boolean;
  attempted: number;
  /** Top-level totals for dashboards / status checks. */
  totals: {
    created: number;
    linked: number;
    skipped: number;
  };
  /** Per-kind counts so consumers can render detail without re-deriving from `operations`. */
  created: {
    services: string[];
    events: string[];
    channels: string[];
  };
  edges: {
    sends: { service: string; event: string }[];
    receives: { service: string; event: string }[];
    messages: { channel: string; event: string }[];
  };
  /** Counts of declared- vs inferred-schema events created. Reveals adoption of `defineEvent`. */
  schemaSources: {
    declared: number;
    inferred: number;
  };
  skipped: {
    services: string[];
    events: string[];
    channels: string[];
  };
};

type Sdk = ReturnType<typeof utils> & {
  writeService: (
    service: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  writeEvent: (
    event: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  writeChannel: (
    channel: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  addSchemaToEvent: (
    id: string,
    schema: { schema: string; fileName: string },
    version?: string,
  ) => Promise<void>;
  addEventToService: (
    id: string,
    direction: 'sends' | 'receives',
    event: { id: string; version: string },
    version?: string,
  ) => Promise<void>;
  addEventToChannel: (
    id: string,
    event: { id: string; version: string; parameters?: Record<string, string> },
    version?: string,
  ) => Promise<void>;
};

const DEFAULT_VERSION = '1.0.0';

export async function generateCatalogFromSnapshot(
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const {
    snapshot,
    catalogPath,
    dryRun = false,
    edgesOnly = false,
    version: resourceVersion = DEFAULT_VERSION,
  } = opts;
  const sdk = utils(catalogPath) as Sdk;
  const state = await readCatalogState(catalogPath);

  const operations: GenerateSummaryItem[] = [];

  const serviceIds = collectServices(snapshot);
  const channelIds = collectChannels(snapshot);

  const knownServices = new Set(state.services.keys());
  const knownChannels = new Set(state.channels.keys());
  const knownEvents = new Map<string, { id: string; version: string }>(
    [...state.events.entries()].map(([id, e]) => [
      normaliseEventId(id),
      { id, version: e.version ?? DEFAULT_VERSION },
    ]),
  );

  if (!edgesOnly) {
    for (const serviceId of serviceIds) {
      if (knownServices.has(serviceId)) {
        operations.push({ kind: 'service', id: serviceId, action: 'exists' });
        continue;
      }
      operations.push({
        kind: 'service',
        id: serviceId,
        action: dryRun ? 'would-create' : 'create',
      });
      if (!dryRun) {
        await sdk.writeService({
          id: serviceId,
          name: serviceId,
          version: resourceVersion,
          summary: `Generated from autotel snapshot (${snapshot.generatedAt})`,
          markdown: buildServiceMarkdown(serviceId, snapshot),
        });
      }
      knownServices.add(serviceId);
    }

    for (const channelId of channelIds) {
      if (knownChannels.has(channelId)) {
        operations.push({ kind: 'channel', id: channelId, action: 'exists' });
        continue;
      }
      operations.push({
        kind: 'channel',
        id: channelId,
        action: dryRun ? 'would-create' : 'create',
      });
      if (!dryRun) {
        await sdk.writeChannel({
          id: channelId,
          name: channelId,
          version: resourceVersion,
          summary: `Generated from autotel snapshot (${snapshot.generatedAt})`,
          address: channelId,
          protocols: ['kafka'],
          markdown: buildChannelMarkdown(channelId, snapshot),
        });
      }
      knownChannels.add(channelId);
    }

    for (const [snapshotName, obs] of Object.entries(snapshot.events)) {
      const normalised = normaliseEventId(snapshotName);
      const existing = knownEvents.get(normalised);
      if (existing) {
        operations.push({
          kind: 'event',
          id: existing.id,
          action: 'exists',
          detail: snapshotName,
        });
        continue;
      }

      const eventId = toCatalogEventId(snapshotName);
      const declared = obs.schema?.jsonSchema;
      const schema =
        (declared && typeof declared === 'object'
          ? (declared as Record<string, unknown>)
          : undefined) ?? inferJsonSchemaFromObservation(obs);
      const schemaSource = declared ? 'declared' : 'inferred';
      operations.push({
        kind: 'event',
        id: eventId,
        action: dryRun ? 'would-create' : 'create',
        detail: snapshotName,
        schemaSource,
      });
      if (!dryRun) {
        await sdk.writeEvent({
          id: eventId,
          name: eventId,
          version: resourceVersion,
          summary: `Generated from autotel snapshot event "${snapshotName}"`,
          schemaPath: 'schema.json',
          markdown: buildEventMarkdown(snapshotName, obs, schemaSource),
          // Bind to channel here rather than via sdk.addEventToChannel,
          // @eventcatalog/sdk@2.21.2 has a bug in addMessageToChannel where
          // the path split uses a string literal instead of a regex, which
          // ends up nesting a duplicate event file under index.mdx/. Setting
          // channels at write-time produces the same frontmatter and avoids
          // the corrupted layout.
          ...(obs.channel
            ? { channels: [{ id: obs.channel, version: DEFAULT_VERSION }] }
            : {}),
        });
        await sdk.addSchemaToEvent(eventId, {
          schema: JSON.stringify(schema, null, 2),
          fileName: 'schema.json',
        });
      }
      knownEvents.set(normalised, { id: eventId, version: resourceVersion });
    }
  }

  // Relationship generation: producer -> sends event
  for (const [snapshotName, obs] of Object.entries(snapshot.events)) {
    const event = knownEvents.get(normaliseEventId(snapshotName));
    if (!event) continue;
    if (obs.producer) {
      operations.push({
        kind: 'service-edge',
        id: `${obs.producer}->${event.id}`,
        action: dryRun ? 'would-link' : 'link',
      });
      if (!dryRun) {
        await sdk.addEventToService(obs.producer, 'sends', {
          id: event.id,
          version: event.version ?? resourceVersion,
        });
      }
    }
    for (const consumer of obs.consumers ?? []) {
      operations.push({
        kind: 'service-edge',
        id: `${consumer}<-${event.id}`,
        action: dryRun ? 'would-link' : 'link',
        detail: 'receives',
      });
      if (!dryRun) {
        await sdk.addEventToService(consumer, 'receives', {
          id: event.id,
          version: event.version ?? resourceVersion,
        });
      }
    }
    if (obs.channel) {
      operations.push({
        kind: 'channel-edge',
        id: `${event.id}->${obs.channel}`,
        action: dryRun ? 'would-link' : 'link',
      });
      // Channel edge is set on the event's `channels` frontmatter at
      // writeEvent time (see workaround note above). No SDK round-trip
      // needed here.
    }
  }

  return { operations };
}

export function buildGenerateSummary(
  result: GenerateResult,
  options: { dryRun: boolean; edgesOnly: boolean },
): GenerateSummary {
  const isCreate = (op: GenerateSummaryItem) =>
    op.action === 'create' || op.action === 'would-create';
  const isLink = (op: GenerateSummaryItem) =>
    op.action === 'link' || op.action === 'would-link';

  const created = {
    services: result.operations
      .filter((o) => o.kind === 'service' && isCreate(o))
      .map((o) => o.id),
    events: result.operations
      .filter((o) => o.kind === 'event' && isCreate(o))
      .map((o) => o.id),
    channels: result.operations
      .filter((o) => o.kind === 'channel' && isCreate(o))
      .map((o) => o.id),
  };

  const sends: { service: string; event: string }[] = [];
  const receives: { service: string; event: string }[] = [];
  const messages: { channel: string; event: string }[] = [];
  for (const op of result.operations) {
    if (!isLink(op)) continue;
    if (op.kind === 'service-edge') {
      if (op.detail === 'receives') {
        const [service, event] = op.id.split('<-');
        if (service && event) receives.push({ service, event });
      } else {
        const [service, event] = op.id.split('->');
        if (service && event) sends.push({ service, event });
      }
    } else if (op.kind === 'channel-edge') {
      const [event, channel] = op.id.split('->');
      if (event && channel) messages.push({ channel, event });
    }
  }

  const schemaSources = {
    declared: result.operations.filter(
      (o) => o.kind === 'event' && o.schemaSource === 'declared',
    ).length,
    inferred: result.operations.filter(
      (o) => o.kind === 'event' && o.schemaSource === 'inferred',
    ).length,
  };

  const skipped = {
    services: result.operations
      .filter((o) => o.kind === 'service' && o.action === 'exists')
      .map((o) => o.id),
    events: result.operations
      .filter((o) => o.kind === 'event' && o.action === 'exists')
      .map((o) => o.id),
    channels: result.operations
      .filter((o) => o.kind === 'channel' && o.action === 'exists')
      .map((o) => o.id),
  };

  const totalCreated =
    created.services.length + created.events.length + created.channels.length;
  const totalLinked = sends.length + receives.length + messages.length;
  const totalSkipped =
    skipped.services.length + skipped.events.length + skipped.channels.length;

  return {
    spec: GENERATE_SUMMARY_SPEC,
    dryRun: options.dryRun,
    edgesOnly: options.edgesOnly,
    attempted: result.operations.length,
    totals: {
      created: totalCreated,
      linked: totalLinked,
      skipped: totalSkipped,
    },
    created,
    edges: { sends, receives, messages },
    schemaSources,
    skipped,
  };
}

export function inferJsonSchemaFromObservation(
  observation: EventObservation,
): Record<string, unknown> {
  const root: Record<string, unknown> = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {},
  };

  const paths = new Set<string>(observation.fieldPaths);
  for (const path of Object.keys(observation.fieldStats ?? {})) {
    paths.add(path);
  }

  const sorted = [...paths].toSorted();
  const stats = observation.fieldStats ?? {};
  for (const path of sorted) {
    insertSchemaPath(root, path, stats[path]?.types ?? []);
  }
  return root;
}

function insertSchemaPath(
  root: Record<string, unknown>,
  path: string,
  observedTypes: string[],
): void {
  if (!path) return;
  const steps = parsePath(path);
  let current = root;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const last = i === steps.length - 1;

    if (!current.properties || typeof current.properties !== 'object') {
      current.properties = {};
    }
    const properties = current.properties as Record<string, unknown>;
    const next =
      (properties[step.key] as Record<string, unknown> | undefined) ?? {};
    properties[step.key] = next;

    if (step.array) {
      next.type = 'array';
      const items =
        (next.items as Record<string, unknown> | undefined) ??
        ({} as Record<string, unknown>);
      next.items = items;
      if (!last && (!items.type || items.type === 'array')) {
        items.type = 'object';
      }
      current = items;
    } else {
      if (last && observedTypes.length > 0) {
        setType(next, observedTypes);
      } else {
        if (!next.type || next.type === 'array') next.type = 'object';
      }
      current = next;
    }
  }
}

function setType(schemaNode: Record<string, unknown>, types: string[]): void {
  const mapped = mapRuntimeTypes(types);
  if (mapped.length === 1) {
    schemaNode.type = mapped[0];
  } else if (mapped.length > 1) {
    schemaNode.type = mapped;
  }
}

function mapRuntimeTypes(types: string[]): string[] {
  const out = new Set<string>();
  for (const t of types) {
    switch (t) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'object':
      case 'array':
      case 'null':
        out.add(t);
        break;
      default:
        break;
    }
  }
  return [...out];
}

function parsePath(path: string): Array<{ key: string; array: boolean }> {
  const segments = path.split('.');
  const out: Array<{ key: string; array: boolean }> = [];
  for (const segment of segments) {
    const isArray = segment.endsWith('[]');
    out.push({
      key: isArray ? segment.slice(0, -2) : segment,
      array: isArray,
    });
  }
  return out;
}

function collectServices(snapshot: ArchitectureSnapshot): Set<string> {
  const out = new Set<string>();
  for (const obs of Object.values(snapshot.events)) {
    if (obs.producer) out.add(obs.producer);
    for (const consumer of obs.consumers ?? []) out.add(consumer);
  }
  return out;
}

function collectChannels(snapshot: ArchitectureSnapshot): Set<string> {
  const out = new Set<string>();
  for (const obs of Object.values(snapshot.events)) {
    if (obs.channel) out.add(obs.channel);
  }
  return out;
}

const GENERATED_MARKER = '<!-- autotel:generated -->';

const GENERATED_PREAMBLE = `${GENERATED_MARKER}
<!-- Edit freely. Subsequent \`autotel-eventcatalog generate\` runs skip files that already exist. -->`;

function buildEventMarkdown(
  snapshotName: string,
  obs: EventObservation,
  schemaSource: 'declared' | 'inferred',
): string {
  const traceLine = obs.sampleTraceIds[0]
    ? `- Sample trace: \`${obs.sampleTraceIds[0]}\`\n`
    : '';
  const producerLine = obs.producer ? `- Producer: \`${obs.producer}\`\n` : '';
  const channelLine = obs.channel ? `- Channel: \`${obs.channel}\`\n` : '';
  const sourceLine =
    schemaSource === 'declared'
      ? '- Schema source: declared at the `track()` call site (Zod)'
      : '- Schema source: inferred from observed `fieldStats` (no declared schema at the call site yet)';

  return `${GENERATED_PREAMBLE}

## ${snapshotName}

*Generated from autotel snapshot. Add a human description, examples, and ownership.*

### Evidence
- Observed **${obs.observedCount}** time${obs.observedCount === 1 ? '' : 's'}
- First seen: \`${obs.firstSeen}\`
- Last seen: \`${obs.lastSeen}\`
${producerLine}${channelLine}${traceLine}${sourceLine}
`;
}

function buildServiceMarkdown(
  serviceId: string,
  snapshot: ArchitectureSnapshot,
): string {
  const sends = Object.entries(snapshot.events)
    .filter(([, obs]) => obs.producer === serviceId)
    .map(([name]) => `- \`${name}\``)
    .join('\n');
  const sendsBlock = sends ? `### Sends\n${sends}\n` : '';

  return `${GENERATED_PREAMBLE}

## ${serviceId}

*Generated from autotel snapshot. Add a human description and ownership.*

${sendsBlock}`;
}

function buildChannelMarkdown(
  channelId: string,
  snapshot: ArchitectureSnapshot,
): string {
  const messages = Object.entries(snapshot.events)
    .filter(([, obs]) => obs.channel === channelId)
    .map(([name]) => `- \`${name}\``)
    .join('\n');
  const messagesBlock = messages ? `### Carries\n${messages}\n` : '';

  return `${GENERATED_PREAMBLE}

## ${channelId}

*Generated from autotel snapshot. Add transport details, retention, schema registry, etc.*

${messagesBlock}`;
}

function toCatalogEventId(snapshotEventName: string): string {
  return snapshotEventName
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function normaliseEventId(id: string): string {
  return id.toLowerCase().replaceAll(/[._\-\s]/g, '');
}
