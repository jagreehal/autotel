/**
 * The devtools' own WebMCP tool surface.
 *
 * Devtools answers "what just happened in my app" for a person reading the
 * panel. These tools answer it for an agent driving the page, over the same
 * query API the UI uses.
 *
 * Results are projected, not passed through. A `TraceData` is a whole span tree
 * and a page of them would swamp an agent's context — the same result-size
 * problem `autotel-webmcp` records as `webmcp.result.bytes`. Each tool returns
 * the columns the panel's list view shows, and `autotel_get_trace` is how an
 * agent asks for the spans of the one trace it cares about.
 *
 * Registered against `document.modelContext` directly, with no library, the way
 * `autotel-webmcp` instruments it. The tests drive this through `webmcpable`'s
 * conformance-checked double, so what this module assumes about Chrome is
 * checked against measured behaviour rather than trusted.
 */

import {
  queryErrors,
  queryLogs,
  queryTraces,
  queryWebMcp,
  type QueryClientDeps,
} from './query-client';
import type { LogData, SpanData, TraceData } from './types';

/**
 * The slice of WebMCP this module uses.
 *
 * Declared locally rather than globally: `webmcp-types` omits `executeTool`
 * (which only the tests need), and an ambient `Document` augmentation from a
 * widget module would leak into every other package that builds against it.
 */
interface ModelContext {
  registerTool(
    tool: {
      annotations?: { readOnlyHint?: boolean };
      description: string;
      execute: (input: Record<string, unknown>) => Promise<string>;
      inputSchema?: Record<string, unknown>;
      name: string;
    },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

function modelContext(): ModelContext | undefined {
  return (document as { modelContext?: ModelContext }).modelContext;
}

/** What `mount()` hands back, so a caller can withdraw the whole surface. */
export interface ToolRegistry {
  mount(): Promise<void>;
  unmount(): void;
}

interface ToolDef {
  description: string;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
  input?: Record<string, unknown>;
}

/** Cap on rows any one call may return, whatever the agent asks for. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function clampLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit))
    return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

/** The grammar, stated for the agent rather than left to guess from a field name. */
const QUERY_HELP =
  'Filter expression, e.g. `service = api duration > 100`, `status = ERROR`, ' +
  '`name contains checkout`. Conditions side by side mean AND; `OR` and ' +
  'parentheses work. A bare word is free text, matched against the span name, ' +
  'service, trace id and every attribute value. Empty string matches everything.';

const queryInput = {
  type: 'object',
  properties: {
    query: { type: 'string', description: QUERY_HELP },
    limit: {
      type: 'number',
      description: `Rows to return, 1–${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}.`,
    },
  },
};

function summariseTrace(trace: TraceData) {
  return {
    traceId: trace.traceId,
    name: trace.rootSpan.name,
    service: trace.service,
    status: trace.status,
    durationMs: Math.round(trace.duration),
    spans: trace.spans.length,
    startedAt: new Date(trace.startTime).toISOString(),
    ...(trace.partial && { partial: true }),
  };
}

function summariseSpan(span: SpanData) {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: span.kind,
    durationMs: Math.round(span.duration),
    status: span.status.code,
    ...(span.status.message && { statusMessage: span.status.message }),
    attributes: span.attributes,
  };
}

function summariseLog(log: LogData) {
  return {
    severity: log.severityText ?? 'UNSET',
    body: typeof log.body === 'string' ? log.body : JSON.stringify(log.body),
    service: log.resourceName,
    traceId: log.traceId,
    at: new Date(log.timestamp).toISOString(),
  };
}

/**
 * A failed query as a sentence the agent can act on: fix the query, start the
 * receiver, or retry.
 *
 * Returned, never thrown. Chrome replaces a thrown handler's message with a
 * generic `UnknownError`, so an agent that could have corrected its own query
 * would instead be told a script failed.
 */
function explain(
  result:
    | { status: 'invalid'; errors: Array<{ message: string }> }
    | { status: 'aborted' }
    | { status: 'error'; message: string },
): string {
  if (result.status === 'invalid') {
    return `Invalid query: ${result.errors.map((e) => e.message).join('; ')}`;
  }
  if (result.status === 'aborted') return 'Query cancelled.';
  return `Devtools query failed: ${result.message}`;
}

/**
 * Everything Chrome does between a handler returning and an agent reading.
 *
 * Three measured behaviours, compensated for once so no handler repeats them. A
 * non-string is serialised, which is what the agent receives either way.
 * `undefined` becomes an empty result — Chrome presents that as "Operation
 * succeeded" — rather than the literal nine characters `JSON.stringify` leaves.
 * And a throw becomes readable text, because Chrome discards the message for a
 * generic `UnknownError`; the handlers return their own failures, so this
 * catches only what they cannot, such as a bad timestamp reaching `toISOString`.
 */
async function toToolResult(
  def: ToolDef,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const value = await def.execute(input ?? {});
    if (typeof value === 'string') return value;
    return JSON.stringify(value) ?? '';
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function toolDefs(deps: QueryClientDeps): Record<string, ToolDef> {
  return {
    autotel_query_traces: {
      description:
        'Search traces the local devtools receiver has stored. Returns one row ' +
        'per trace: id, root span name, service, status, duration and span count. ' +
        'Use autotel_get_trace for the spans of a specific trace.',
      input: queryInput,
      execute: async (input) => {
        const result = await queryTraces(
          {
            query: typeof input.query === 'string' ? input.query : '',
            limit: clampLimit(input.limit),
          },
          deps,
        );
        if (result.status !== 'ok') return explain(result);
        return {
          traces: result.traces.map(summariseTrace),
          truncated: result.nextCursor !== null,
        };
      },
    },

    autotel_get_trace: {
      description:
        'Every span of one trace, by id: name, kind, duration, status and ' +
        'attributes. Use after autotel_query_traces has narrowed to a trace ' +
        'worth opening.',
      input: {
        type: 'object',
        properties: {
          traceId: {
            type: 'string',
            description: 'Trace id, as returned by autotel_query_traces.',
          },
        },
        required: ['traceId'],
      },
      execute: async (input) => {
        // A JSON Schema is a description, not a validator, and nothing in the
        // browser enforces `required` — so an agent that skipped the argument
        // is told what to send rather than shown a query for `undefined`.
        const traceId =
          typeof input.traceId === 'string' ? input.traceId.trim() : '';
        if (!traceId) {
          return 'traceId is required — take one from autotel_query_traces.';
        }
        // The query language reaches spans, and a trace id is just a field on
        // them, so this needs no endpoint of its own.
        const result = await queryTraces(
          { query: `trace_id = "${traceId}"`, limit: 1 },
          deps,
        );
        if (result.status !== 'ok') return explain(result);
        const trace = result.traces[0];
        if (!trace) return `No stored trace with id ${traceId}.`;
        return {
          ...summariseTrace(trace),
          spans: trace.spans.map(summariseSpan),
        };
      },
    },

    autotel_list_errors: {
      description:
        'Failing operations grouped by fingerprint: type, message, occurrence ' +
        'count, affected services and sample trace ids. The first call to make ' +
        'when asked what is broken.',
      input: {
        type: 'object',
        properties: { query: { type: 'string', description: QUERY_HELP } },
      },
      execute: async (input) => {
        const result = await queryErrors(
          { query: typeof input.query === 'string' ? input.query : '' },
          deps,
        );
        if (result.status !== 'ok') return explain(result);
        return {
          errors: result.errors.map((group) => ({
            type: group.type,
            message: group.message,
            count: group.count,
            service: group.service,
            lastSeen: new Date(group.lastSeen).toISOString(),
            sampleTraceIds: group.affectedTraces.slice(0, 3),
          })),
        };
      },
    },

    autotel_query_logs: {
      description:
        'Search stored log records. Returns severity, body, service, and the ' +
        'trace id when the log was emitted inside one.',
      input: queryInput,
      execute: async (input) => {
        const result = await queryLogs(
          {
            query: typeof input.query === 'string' ? input.query : '',
            limit: clampLimit(input.limit),
          },
          deps,
        );
        if (result.status !== 'ok') return explain(result);
        return {
          logs: result.logs.map(summariseLog),
          truncated: result.nextCursor !== null,
        };
      },
    },

    autotel_webmcp_inventory: {
      description:
        'The WebMCP tool surface this page has exposed to agents, as recorded ' +
        'by autotel-webmcp: which tools were offered, how often they were ' +
        'called, and which annotations the browser silently discarded at ' +
        "registration. Use to check a page's own tools behave as written.",
      execute: async () => {
        const result = await queryWebMcp({}, deps);
        if (result.status !== 'ok') return explain(result);
        const { summary, tools } = result.webmcp;
        return {
          summary,
          tools: tools.map((tool) => ({
            name: tool.name,
            offered: tool.offered,
            calls: tool.calls,
            hasInputSchema: tool.hasInputSchema,
            annotationsDropped: tool.annotationsDropped,
            labelMismatch: tool.labelMismatch,
            redefined: tool.redefined,
          })),
        };
      },
    },
  };
}

/**
 * Build the registry. `mount()` is a no-op in a browser without WebMCP, so a
 * caller does not feature-detect.
 *
 * One `AbortController` owns every registration, because aborting the signal
 * passed to `registerTool` is how the platform withdraws a tool — there is no
 * `unregister`. That makes teardown a single `abort()` however many tools ran.
 */
export function devtoolsTools(deps: QueryClientDeps): ToolRegistry {
  const controller = new AbortController();
  const defs = toolDefs(deps);

  return {
    async mount() {
      const context = modelContext();
      if (!context) return;
      for (const [name, def] of Object.entries(defs)) {
        await context.registerTool(
          {
            name,
            description: def.description,
            // Every tool is a read over stored telemetry. `readOnlyHint` is one
            // of the two annotations Chrome keeps; anything else is discarded
            // at registration without an error.
            annotations: { readOnlyHint: true },
            ...(def.input && { inputSchema: def.input }),
            // The draft passes `(input, options)` and Chrome passes the input
            // alone. Reading only the first argument works on both.
            execute: (input) => toToolResult(def, input),
          },
          { signal: controller.signal },
        );
      }
    },

    unmount() {
      controller.abort();
    },
  };
}
