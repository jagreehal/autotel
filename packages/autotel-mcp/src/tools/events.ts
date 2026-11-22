/**
 * MCP Events (SEP-3415) on this server: `events/list` and `events/poll` for
 * the telemetry event types in `modules/telemetry-events.ts`.
 *
 * The SDK has no Events API, so these are custom request handlers on the
 * underlying `Server`. Read-only, like every tool here: a poll reads the
 * backend and remembers nothing.
 */

import { ProtocolError, type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { TelemetryBackend } from '../backends/telemetry';
import type { SpanSearchQuery } from '../types';
import { loadIssues } from '../modules/issues';
import {
  pollTelemetryEvents,
  RATE_LIMITED_POLL_MS,
  TELEMETRY_EVENT_TYPES,
  TelemetryEventError,
  type TelemetryEventSources,
} from '../modules/telemetry-events';
import { sampleSpans } from '../modules/window-sample';

/** SEP-3415's codes. `NotFound` is provisional in the spec until allocated. */
const ERROR_CODES = { NotFound: -32_023, InvalidParams: -32_602 } as const;

const ListParams = z.looseObject({ cursor: z.string().optional() });
const PollParams = z.looseObject({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  cursor: z.string().nullable().optional(),
  maxAgeMs: z.number().int().nonnegative().optional(),
  maxEvents: z.number().int().positive().optional(),
});
const AnyResult = z.looseObject({});

export function telemetryEventSources(
  backend: TelemetryBackend,
): TelemetryEventSources {
  const sources: TelemetryEventSources = {
    issues: async ({ service, startMs, endMs }) => {
      const { issues, capped } = await loadIssues(backend, {
        service,
        lookbackMinutes: Math.ceil((endMs - startMs) / 60_000),
        quietMinutes: 60,
        status: 'all',
        nowUnixMs: endMs,
      });
      return { items: issues, capped };
    },
    spans: ({ service, startMs, endMs }) => {
      const query: SpanSearchQuery = {
        startTimeUnixMs: startMs,
        endTimeUnixMs: endMs,
      };
      if (service) query.service = service;
      return sampleSpans(
        backend,
        query,
        // A change is a boundary, so a full quarter is split once more, as
        // what_changed does; never on Datadog's tight spans budget.
        { refine: backend.aggregateSpans === undefined },
      );
    },
  };
  // Server-side aggregation marks Datadog, whose spans budget is the tight one.
  if (backend.aggregateSpans) sources.nextPollMs = RATE_LIMITED_POLL_MS;
  return sources;
}

export function registerTelemetryEvents(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  const sources = telemetryEventSources(backend);
  server.server.setRequestHandler(
    'events/list',
    { params: ListParams, result: AnyResult },
    async () => ({ events: TELEMETRY_EVENT_TYPES }),
  );
  server.server.setRequestHandler(
    'events/poll',
    { params: PollParams, result: AnyResult },
    async (params: z.infer<typeof PollParams>) => {
      try {
        return { ...(await pollTelemetryEvents(params, sources)) };
      } catch (error) {
        if (error instanceof TelemetryEventError) {
          throw new ProtocolError(
            ERROR_CODES[error.kind],
            error.message,
            error.kind === 'NotFound' ? { kind: 'event' } : undefined,
          );
        }
        throw error;
      }
    },
  );
}
