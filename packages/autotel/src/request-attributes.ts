/**
 * Attributes set through `requestCtx` describe the whole request, so every
 * span started inside that request carries them too - not only the request
 * span. This stays in-process: nothing rides baggage, so a `user.email` set in
 * auth middleware never leaves in a `baggage` header on an outgoing call.
 */

import {
  createContextKey,
  context,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import type {
  Span as SdkSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { isFunction, readProperty } from './values';

/**
 * The key `@opentelemetry/core` publishes RPC metadata under. `createContextKey`
 * is `Symbol.for`, so this reads exactly what `instrumentation-http` (and every
 * framework instrumentation that renames the route) wrote, without taking a
 * dependency on core.
 */
const RPC_METADATA_KEY = createContextKey(
  'OpenTelemetry SDK Context Key RPC_METADATA',
);

/**
 * `span` when it belongs to `traceId`'s trace. Context keeps the request span
 * and the local root after code starts a separate trace inside them
 * (`withNewContext()`, a `root: true` span), and writing through them then
 * would tag a different trace. With no trace to compare against, `span`.
 */
function inTrace(
  span: Span | undefined,
  traceId: string | undefined,
): Span | undefined {
  return span && (!traceId || span.spanContext().traceId === traceId)
    ? span
    : undefined;
}

/**
 * The server span of the request `ctx` belongs to, if it belongs to one: in
 * the trace of `traceId`, by default the trace of the span active in `ctx`.
 */
export function getRequestSpanIn(
  ctx: Context = context.active(),
  traceId: string | undefined = trace.getSpanContext(ctx)?.traceId,
): Span | undefined {
  const requestSpan = readProperty(ctx.getValue(RPC_METADATA_KEY), 'span');
  // SAFETY: RPC metadata carries the server span; anything else under that key
  // is not one.
  return isFunction(readProperty(requestSpan, 'spanContext'))
    ? inTrace(requestSpan as Span, traceId)
    : undefined;
}

/**
 * The local root `trace()` started: the span with no parent, or a remote one,
 * that this process's work hangs under. A batch job or queue consumer has no
 * server span, so this is what `requestCtx` aims at there.
 */
const LOCAL_ROOT_KEY = createContextKey('autotel.local_root_span');

export function withLocalRoot(ctx: Context, span: Span): Context {
  return ctx.setValue(LOCAL_ROOT_KEY, span);
}

/** The local root `ctx` carries, in the trace of the span active in it. */
export function getLocalRootSpanIn(
  ctx: Context = context.active(),
): Span | undefined {
  const span = ctx.getValue(LOCAL_ROOT_KEY);
  // SAFETY: only withLocalRoot writes this key, and it writes a span.
  return span === undefined
    ? undefined
    : inTrace(span as Span, trace.getSpanContext(ctx)?.traceId);
}

interface AttributeScope {
  attributes: Attributes;
  parent?: AttributeScope;
}

// Descendants retain attribute scopes, never the ancestor spans themselves.
const scopes = new WeakMap<Span, AttributeScope>();

function scopeFor(span: Span): AttributeScope {
  let scope = scopes.get(span);
  if (!scope) {
    scope = { attributes: {} };
    scopes.set(span, scope);
  }
  return scope;
}

/**
 * The request span's attributes, or else every ancestor `requestCtx` wrote to,
 * merged so the nearer one wins a key: a job span tagging `job.id` under a
 * consumer that tagged `tenant` must not hide the tenant from its children.
 */
function sourceOf(
  parentContext: Context,
  traceId: string,
): Attributes | undefined {
  // Compared against the span starting, not the parent: a `root: true` span
  // starts a new trace under a context still holding the old request.
  const requestSpan = getRequestSpanIn(parentContext, traceId);
  if (requestSpan) return scopes.get(requestSpan)?.attributes;
  const nearestFirst: Attributes[] = [];
  const parent = trace.getSpan(parentContext);
  const sameTrace = parent?.spanContext().traceId === traceId;
  for (
    let scope = sameTrace ? scopes.get(parent) : undefined;
    scope;
    scope = scope.parent
  ) {
    nearestFirst.push(scope.attributes);
  }
  return nearestFirst.length > 0
    ? Object.assign({}, ...nearestFirst.toReversed())
    : undefined;
}

/** Remember attributes set through `requestCtx`, for the spans started under it. */
export function rememberRequestAttributes(span: Span, attrs: Attributes): void {
  Object.assign(scopeFor(span).attributes, attrs);
}

/**
 * Copies `requestCtx` attributes onto each span started inside the request -
 * or, outside one, under the span `requestCtx` fell back to. Only what was set
 * before the span started is copied, and a key the span already carries keeps
 * its own value.
 */
export class RequestAttributesSpanProcessor implements SpanProcessor {
  onStart(span: SdkSpan, parentContext: Context): void {
    const { traceId } = span.spanContext();
    const parent = trace.getSpan(parentContext);
    // A span starting a new trace inherits nothing from the old one.
    if (parent && parent.spanContext().traceId === traceId) {
      scopeFor(span).parent = scopeFor(parent);
    }
    const attrs = sourceOf(parentContext, traceId);
    if (!attrs) return;
    const own = span.attributes;
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && !(key in own)) span.setAttribute(key, value);
    }
  }

  onEnd(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
