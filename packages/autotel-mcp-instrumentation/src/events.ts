/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof, anti-slop/no-reflect-apply, anti-slop/no-reflect-get, anti-slop/no-object-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- Decodes MCP Events messages from peers (occurrences and their `_meta` are arbitrary JSON) and wraps the SDK's own request, notify and handler methods, whose shapes vary by SDK version; every field is checked before it reaches a span or metric. */
/**
 * MCP Events (SEP-3415, `io.modelcontextprotocol/events`): a client subscribes
 * to upstream events and an agent reacts when one occurs, often with nobody
 * watching. That is exactly when tracing has to answer "why did the agent do
 * that?", so the reaction must lead back to the event and the event to what
 * caused it.
 *
 * - **Requests** (`events/list`, `events/poll`, `events/subscribe`,
 *   `events/unsubscribe`) get the usual MCP request spans on both ends, named
 *   `{method} {event name}`, with what a poll returned (`mcp.event.count`,
 *   `.truncated`, `.has_more`).
 * - **`events/stream`** is a request that stays open until it is cancelled, so
 *   it is never one span. Its span covers opening the stream and ends at the
 *   server's `notifications/events/active` confirmation; each pushed
 *   occurrence is a `send {name}` producer span of its own.
 * - **Occurrences** carry trace context in their `_meta`. A server that emits
 *   one inside the trace that caused it adds `injectOtelContextToMeta()`;
 *   otherwise the `send` span puts its own there. The client's
 *   `process {name}` consumer span *links* to it rather than continuing it:
 *   the agent's reaction is new work, not part of the upstream request.
 * - **Payloads are never recorded.** The spec treats them as untrusted, like
 *   tool results, and they come from systems this package knows nothing about.
 *
 * Nothing here imports an MCP SDK, which has no Events API yet anyway: servers
 * register `events/*` handlers with `setRequestHandler(method, schemas, …)`,
 * clients send them with `request()`, and both are wrapped by shape.
 */

import { context, trace, type Attributes, type Link } from '@opentelemetry/api';
import { SpanKind, withTracing, type TraceContext } from '#runtime';
import {
  extractOtelContextFromMeta,
  injectOtelContextToMeta,
  serverParentContext,
} from './context';
import { recordableError, rethrowOriginal, thrownInSpan } from './content.js';
import { errorName } from './error-name.js';
import {
  recordEventGap,
  recordEventReceived,
  recordEventsDelivered,
  recordSubscriptionTerminated,
} from './metrics';
import {
  MCP_EVENT_NOTIFICATIONS,
  MCP_METHODS,
  MCP_SEMCONV,
  type McpEventDelivery,
} from './semantic-conventions';
import { resolveConfig, type McpInstrumentationConfig } from './types';
import {
  asRecord,
  asString,
  isFunction,
  readProperty,
  type UnknownRecord,
} from './values.js';
import { patchRequestHandlers, type RequestHandler } from './request-handlers';

type ResolvedConfig = ReturnType<typeof resolveConfig>;

/** One occurrence as SEP-3415 defines it. Only `name` is relied on. */
export interface McpEventOccurrence {
  eventId?: string;
  name?: string;
  timestamp?: string;
  data?: unknown;
  cursor?: string | null;
  _meta?: Record<string, unknown>;
}

/** The `events/*` request methods a server handles. */
export const EVENTS_REQUEST_METHODS: readonly string[] = [
  MCP_METHODS.EVENTS_LIST,
  MCP_METHODS.EVENTS_POLL,
  MCP_METHODS.EVENTS_STREAM,
  MCP_METHODS.EVENTS_SUBSCRIBE,
  MCP_METHODS.EVENTS_UNSUBSCRIBE,
];

const DELIVERY_BY_METHOD = new Map<string, McpEventDelivery>([
  [MCP_METHODS.EVENTS_POLL, 'poll'],
  [MCP_METHODS.EVENTS_STREAM, 'push'],
  [MCP_METHODS.EVENTS_SUBSCRIBE, 'webhook'],
  [MCP_METHODS.EVENTS_UNSUBSCRIBE, 'webhook'],
]);

// ── Shared ─────────────────────────────────────────────────────────────────

function requestAttributes(
  method: string,
  name: string | undefined,
): Attributes {
  const attributes: Attributes = { [MCP_SEMCONV.METHOD_NAME]: method };
  if (name) attributes[MCP_SEMCONV.EVENT_NAME] = name;
  const delivery = DELIVERY_BY_METHOD.get(method);
  if (delivery) attributes[MCP_SEMCONV.EVENT_DELIVERY] = delivery;
  return attributes;
}

function occurrenceAttributes(
  occurrence: UnknownRecord | undefined,
  delivery: McpEventDelivery,
): Attributes {
  const attributes: Attributes = { [MCP_SEMCONV.EVENT_DELIVERY]: delivery };
  const name = asString(occurrence?.name);
  const id = asString(occurrence?.eventId);
  if (name) attributes[MCP_SEMCONV.EVENT_NAME] = name;
  if (id) attributes[MCP_SEMCONV.EVENT_ID] = id;
  return attributes;
}

/** Metric labels: never the event id, one series per occurrence. */
function metricAttributes(
  name: string | undefined,
  delivery: McpEventDelivery,
): Attributes {
  return name
    ? { [MCP_SEMCONV.EVENT_NAME]: name, [MCP_SEMCONV.EVENT_DELIVERY]: delivery }
    : { [MCP_SEMCONV.EVENT_DELIVERY]: delivery };
}

/** A link to the span an occurrence's `_meta` names, when it names one. */
function linkFromMeta(meta: unknown): Link | undefined {
  const record = asRecord(meta);
  if (typeof record?.traceparent !== 'string') return undefined;
  const linked = trace.getSpanContext(extractOtelContextFromMeta(record));
  return linked && trace.isSpanContextValid(linked)
    ? { context: linked }
    : undefined;
}

/** `_meta` with the active trace context added. Keys already there win. */
function metaWithTraceContext(meta: unknown): UnknownRecord {
  const injected = Object.fromEntries(
    Object.entries(injectOtelContextToMeta()).filter(([, v]) => v),
  );
  return { ...injected, ...asRecord(meta) };
}

/** Seconds since `timestamp`, or undefined when it does not parse. */
function lagSeconds(timestamp: unknown): number | undefined {
  const at = Date.parse(String(timestamp));
  return Number.isFinite(at)
    ? Math.max(0, (Date.now() - at) / 1000)
    : undefined;
}

/**
 * Run `work` inside a span, recording a failure the way every traced path in
 * this package must (see content.ts): one recordable copy, thrown through
 * the span, the original rethrown outside it.
 */
function traced<R>(
  name: string,
  kind: SpanKind,
  config: ResolvedConfig,
  label: string,
  work: (ctx: TraceContext) => Promise<R>,
  onError?: (ctx: TraceContext) => void,
): Promise<R> {
  return withTracing({ name, spanKind: kind })(
    (ctx: TraceContext) => async () => {
      try {
        return await work(ctx);
      } catch (error) {
        onError?.(ctx);
        const recorded = recordableError(config, error, label);
        if (config.captureErrors) {
          ctx.recordError(recorded);
          ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, errorName(error));
        }
        throw thrownInSpan(error, recorded);
      }
    },
  )().catch(rethrowOriginal);
}

/**
 * What a poll returned, on its span: count, `truncated`, `hasMore`. Returns
 * the occurrences and the answer for the caller's metrics.
 */
/** A poll's answer, as recorded: its occurrences and whether it was cut. */
interface PollAnswer {
  events: unknown[];
  truncated: boolean;
}

function recordPollAnswer(ctx: TraceContext, result: unknown): PollAnswer {
  const answer = asRecord(result);
  const events = Array.isArray(answer?.events) ? answer.events : [];
  ctx.setAttribute(MCP_SEMCONV.EVENT_COUNT, events.length);
  if (typeof answer?.truncated === 'boolean')
    ctx.setAttribute(MCP_SEMCONV.EVENT_TRUNCATED, answer.truncated);
  if (typeof answer?.hasMore === 'boolean')
    ctx.setAttribute(MCP_SEMCONV.EVENT_HAS_MORE, answer.hasMore);
  return { events, truncated: answer?.truncated === true };
}

// ── Server ─────────────────────────────────────────────────────────────────

/**
 * The event name a request asks about, and the trace it continues: from the
 * SDK's `ctx.mcpReq._meta`, else the params'. Events needs MCP 2026-07-28, so
 * there is no 2025-era `extra` to read.
 */
function requestFacts(request: unknown, handlerCtx: unknown) {
  const params = readProperty(request, 'params');
  const meta =
    readProperty(readProperty(handlerCtx, 'mcpReq'), '_meta') ??
    readProperty(params, '_meta');
  return {
    name: asString(readProperty(params, 'name')),
    parent: serverParentContext(asRecord(meta)),
  };
}

/**
 * The handler context with `ctx.mcpReq.notify` traced. A Proxy rather than a
 * copy, because the SDK's context may carry methods a spread would drop.
 */
function withTracedNotify(
  handlerCtx: unknown,
  config: ResolvedConfig,
  onActive: (params: UnknownRecord | undefined) => void,
): unknown {
  const mcpReq = readProperty(handlerCtx, 'mcpReq');
  const notify = readProperty(mcpReq, 'notify');
  if (
    !isFunction(notify) ||
    typeof mcpReq !== 'object' ||
    mcpReq === null ||
    typeof handlerCtx !== 'object' ||
    handlerCtx === null
  )
    return handlerCtx;

  const tracedNotify = (notification: unknown, ...rest: unknown[]) => {
    const method = asString(readProperty(notification, 'method'));
    const params = asRecord(readProperty(notification, 'params'));
    if (method === MCP_EVENT_NOTIFICATIONS.ACTIVE) onActive(params);
    if (method !== MCP_EVENT_NOTIFICATIONS.EVENT)
      return Reflect.apply(notify, mcpReq, [notification, ...rest]);
    return sendOccurrence(params, config, (sent) =>
      Reflect.apply(notify, mcpReq, [
        // SAFETY: `method` was read off it above, so it is an object.
        { ...(notification as object), params: sent },
        ...rest,
      ]),
    );
  };
  const tracedReq = new Proxy(mcpReq, {
    get: (t, p) => (p === 'notify' ? tracedNotify : Reflect.get(t, p)),
  });
  return new Proxy(handlerCtx, {
    get: (t, p) => (p === 'mcpReq' ? tracedReq : Reflect.get(t, p)),
  });
}

/**
 * One pushed occurrence as a `send {name}` producer span. An occurrence that
 * already names the trace that caused it keeps it, and the span links there;
 * otherwise the span's own context goes in `_meta` for the client to link to.
 */
function sendOccurrence(
  occurrence: UnknownRecord | undefined,
  config: ResolvedConfig,
  send: (params: UnknownRecord | undefined) => unknown,
): Promise<unknown> {
  const name = asString(occurrence?.name);
  return traced(
    name ? `send ${name}` : 'send',
    SpanKind.PRODUCER,
    config,
    name ?? 'event',
    async (ctx) => {
      ctx.setAttributes(occurrenceAttributes(occurrence, 'push'));
      const cause = linkFromMeta(occurrence?._meta);
      if (cause) ctx.addLink(cause);
      const sent = cause
        ? occurrence
        : { ...occurrence, _meta: metaWithTraceContext(occurrence?._meta) };
      const result = await send(sent);
      if (config.enableMetrics)
        recordEventsDelivered(1, metricAttributes(name, 'push'));
      return result;
    },
  );
}

/**
 * Trace one `events/*` request handler, as stored on the SDK's request
 * handler map: `(request, ctx)`, whatever the era.
 */
export function traceEventsRequest(
  method: string,
  raw: RequestHandler,
  config: ResolvedConfig,
): RequestHandler {
  if (method === MCP_METHODS.EVENTS_STREAM)
    return traceEventsStream(raw, config);
  return (request, handlerCtx) => {
    const { name, parent } = requestFacts(request, handlerCtx);
    const tracedCtx = withTracedNotify(handlerCtx, config, () => {});
    return context.with(parent, () =>
      traced(
        name ? `${method} ${name}` : method,
        SpanKind.SERVER,
        config,
        name ?? method,
        async (ctx) => {
          ctx.setAttributes(requestAttributes(method, name));
          const result = await raw(request, tracedCtx);
          if (method === MCP_METHODS.EVENTS_POLL) {
            const { events } = recordPollAnswer(ctx, result);
            if (config.enableMetrics)
              recordEventsDelivered(
                events.length,
                metricAttributes(name, 'poll'),
              );
          }
          return result;
        },
        // The name came from the client and was not served: keep it off the
        // span name, where an unbounded set of names would be cardinality.
        (ctx) => ctx.updateName(method),
      ),
    );
  };
}

/**
 * `events/stream` stays open until cancelled, so its span covers only the
 * opening: it ends at the `notifications/events/active` confirmation, or when
 * the handler settles if that comes first. The occurrences that follow are
 * spans of their own, children of this one.
 */
function traceEventsStream(
  raw: RequestHandler,
  config: ResolvedConfig,
): RequestHandler {
  const method = MCP_METHODS.EVENTS_STREAM;
  return (request, handlerCtx) => {
    const { name, parent } = requestFacts(request, handlerCtx);
    let confirmed!: () => void;
    const active = new Promise<void>((resolve) => (confirmed = resolve));
    let handled: Promise<unknown> | undefined;
    const opening = context.with(parent, () =>
      traced(
        name ? `${method} ${name}` : method,
        SpanKind.SERVER,
        config,
        name ?? method,
        async (ctx) => {
          ctx.setAttributes(requestAttributes(method, name));
          const tracedCtx = withTracedNotify(handlerCtx, config, (params) => {
            if (typeof params?.truncated === 'boolean')
              ctx.setAttribute(MCP_SEMCONV.EVENT_TRUNCATED, params.truncated);
            confirmed();
          });
          // Started inside the span, so the occurrences it sends are its
          // children; the span itself ends at the confirmation.
          handled = Promise.resolve().then(() => raw(request, tracedCtx));
          await Promise.race([active, handled]);
        },
        (ctx) => ctx.updateName(method),
      ),
    );
    return opening.then(() => handled);
  };
}

/**
 * MCP Events (`events/*`) handlers, on whichever object owns the handler map:
 * a low-level `Server`, or the one inside an `McpServer` (`.server`), where an
 * Events server registers them since McpServer has no Events API.
 */
export function traceEventsHandlers(
  server: unknown,
  config: ResolvedConfig,
): void {
  const owner =
    readProperty(server, '_requestHandlers') instanceof Map
      ? server
      : readProperty(server, 'server');
  patchRequestHandlers(
    owner,
    EVENTS_REQUEST_METHODS,
    EVENTS_REQUEST_METHODS,
    (method, raw) => traceEventsRequest(method, raw, config),
  );
}

// ── Client ─────────────────────────────────────────────────────────────────

/**
 * React to one occurrence inside a `process {name}` consumer span, linked to
 * the trace the occurrence came from.
 *
 * Push occurrences get this automatically from a handler registered with
 * `setNotificationHandler('notifications/events/event', …)` on an
 * instrumented client. Call it yourself for each event an `events/poll`
 * returned, and in a webhook receiver for each delivery:
 *
 * ```ts
 * const { events } = await client.request({ method: 'events/poll', params }, schema);
 * for (const event of events) await processEvent(event, () => agent.react(event));
 * ```
 *
 * A poll's receipts are counted where the poll returns them, so
 * `delivery: 'poll'` records no receipt here; push and webhook do.
 */
export function processEvent<R>(
  occurrence: McpEventOccurrence | UnknownRecord,
  react: () => R | Promise<R>,
  options: {
    delivery?: McpEventDelivery;
    config?: McpInstrumentationConfig;
  } = {},
): Promise<R> {
  return processOccurrence(
    asRecord(occurrence),
    options.delivery ?? 'poll',
    resolveConfig(options.config),
    react,
  );
}

function processOccurrence<R>(
  occurrence: UnknownRecord | undefined,
  delivery: McpEventDelivery,
  config: ResolvedConfig,
  react: () => R | Promise<R>,
): Promise<R> {
  const name = asString(occurrence?.name);
  if (delivery !== 'poll' && config.enableMetrics)
    recordEventReceived(
      lagSeconds(occurrence?.timestamp),
      metricAttributes(name, delivery),
    );
  return traced<R>(
    name ? `process ${name}` : 'process',
    SpanKind.CONSUMER,
    config,
    name ?? 'event',
    async (ctx) => {
      ctx.setAttributes(occurrenceAttributes(occurrence, delivery));
      const cause = linkFromMeta(occurrence?._meta);
      if (cause) ctx.addLink(cause);
      // SAFETY: `react` is the caller's callback, typed to resolve to R.
      return (await react()) as R;
    },
  );
}

/**
 * `client.request` with `events/*` traced. `events/stream` gets trace context
 * in `_meta` and no span, since the request lasts as long as the
 * subscription; its occurrences are traced as they arrive.
 */
export function traceEventsClientRequest(
  request: (...args: unknown[]) => unknown,
  target: object,
  config: ResolvedConfig,
): (...args: unknown[]) => unknown {
  return (message: unknown, ...rest: unknown[]) => {
    const method = asString(readProperty(message, 'method'));
    if (!method || !EVENTS_REQUEST_METHODS.includes(method))
      return Reflect.apply(request, target, [message, ...rest]);
    const params = asRecord(readProperty(message, 'params')) ?? {};
    const send = () =>
      Reflect.apply(request, target, [
        {
          // SAFETY: `method` was read off it above, so it is an object.
          ...(message as object),
          params: { ...params, _meta: metaWithTraceContext(params._meta) },
        },
        ...rest,
      ]);
    if (method === MCP_METHODS.EVENTS_STREAM) return send();

    const name = asString(params.name);
    return traced(
      name ? `${method} ${name}` : method,
      SpanKind.CLIENT,
      config,
      name ?? method,
      async (ctx) => {
        ctx.setAttributes(requestAttributes(method, name));
        const result = await send();
        if (method !== MCP_METHODS.EVENTS_POLL) return result;
        const { events, truncated } = recordPollAnswer(ctx, result);
        if (config.enableMetrics) {
          for (const event of events) {
            const occurrence = asRecord(event);
            recordEventReceived(
              lagSeconds(occurrence?.timestamp),
              metricAttributes(asString(occurrence?.name) ?? name, 'poll'),
            );
          }
          if (truncated) recordEventGap(metricAttributes(name, 'poll'));
        }
        return result;
      },
    );
  };
}

/**
 * `client.setNotificationHandler` with the Events notifications traced: each
 * pushed occurrence runs its handler inside a `process {name}` span, a gap
 * reported by `notifications/events/active` and a terminated subscription are
 * counted. Handlers receive `(params, notification)`, the 2026-07-28 SDK's
 * custom-notification shape; Events does not exist on the 2025-era SDK.
 */
export function traceEventsNotificationHandler(
  setNotificationHandler: (...args: unknown[]) => unknown,
  target: object,
  config: ResolvedConfig,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const method = asString(args[0]);
    const handler = args.at(-1);
    if (!method?.startsWith('notifications/events/') || !isFunction(handler))
      return Reflect.apply(setNotificationHandler, target, args);
    const traced = (...received: unknown[]) => {
      const params = asRecord(received[0]);
      const run = () => Reflect.apply(handler, undefined, received);
      if (method === MCP_EVENT_NOTIFICATIONS.EVENT)
        return processOccurrence(params, 'push', config, run);
      if (config.enableMetrics) {
        if (
          method === MCP_EVENT_NOTIFICATIONS.ACTIVE &&
          params?.truncated === true
        )
          recordEventGap({ [MCP_SEMCONV.EVENT_DELIVERY]: 'push' });
        if (method === MCP_EVENT_NOTIFICATIONS.TERMINATED) {
          const code = readProperty(readProperty(params, 'error'), 'code');
          recordSubscriptionTerminated(
            typeof code === 'number' || typeof code === 'string'
              ? { [MCP_SEMCONV.ERROR_TYPE]: String(code) }
              : {},
          );
        }
      }
      return run();
    };
    return Reflect.apply(setNotificationHandler, target, [
      ...args.slice(0, -1),
      traced,
    ]);
  };
}
