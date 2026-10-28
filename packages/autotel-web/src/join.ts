/**
 * Building blocks for joining autotel traces to whatever else is on the page:
 * an error tracker, a session recorder, a product analytics SDK.
 *
 * Every such join is the same two links. The vendor knows things a tracer
 * cannot work out for itself (which recorded session, which person), so those
 * go onto spans. The tracer knows which trace explains a failure, so that goes
 * onto the vendor's events. What differs per vendor is only how to read it and
 * where its hook lives, which is a few lines of the app's own code:
 *
 * ```ts
 * import { enrichSpans, currentSpanContext } from 'autotel-web/join';
 *
 * initFull({
 *   service: 'web',
 *   spanEnrichers: [
 *     enrichSpans({
 *       name: 'logrocket',
 *       session: () => LogRocket.sessionURL ?? undefined,
 *       onFailure: () => ({ 'session.replay.url': LogRocket.sessionURL }),
 *     }),
 *   ],
 * });
 *
 * Bugsnag.addOnError((event) => {
 *   const span = currentSpanContext();
 *   if (span) event.addMetadata('trace', { id: span.traceId });
 * });
 * ```
 *
 * No dependency beyond `@opentelemetry/api` and the dependency-free baggage
 * module, so a page pays only for the join it composes.
 */

import {
  context,
  trace,
  type Attributes,
  type AttributeValue,
  type SpanContext,
} from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { setBaggage } from './baggage';
import { setJoinSessionProvider, settledSessionId } from './session';
import { isDevelopment } from './dev-mode';
import { asRecord, asString, isFunction, type UnknownRecord } from './values';

/** `SpanStatusCode.ERROR`, without importing the enum for one comparison. */
const STATUS_ERROR = 2;

/**
 * Whether a span failed: an error status, or an exception recorded on it.
 */
export function failed(span: ReadableSpan): boolean {
  return (
    span.status?.code === STATUS_ERROR ||
    span.attributes['exception.type'] !== undefined ||
    span.events?.some((event) => event.name === 'exception') === true
  );
}

/**
 * How many started-but-not-ended spans to keep. Deep enough for any real
 * nesting on a page, shallow enough that leaked spans cost nothing.
 */
const MAX_LIVE_SPANS = 128;

/**
 * Spans that have started and not yet ended, newest last, shared by every
 * enricher on the page.
 *
 * Module state on purpose: framework code calls `enrichSpans()` again on every
 * render and only the processor the app registers is ever handed a span, so
 * per-call bookkeeping would split one page's spans across lists nobody reads.
 * One list keyed by span id is the size of what is in flight, however many
 * joins are composed and however often they are rebuilt.
 */
const live: SpanContext[] = [];

function contextOf(span: ReadableSpan): SpanContext | undefined {
  try {
    return isFunction(span.spanContext) ? span.spanContext() : undefined;
  } catch {
    return undefined;
  }
}

function remember(span: ReadableSpan): void {
  const spanContext = contextOf(span);
  if (!spanContext) return;
  // Two joins composed on one page both see every span.
  if (live.some((open) => open.spanId === spanContext.spanId)) return;
  live.push(spanContext);
  // A page can navigate away mid-span, and an SPA that does it a thousand
  // times would otherwise pin every one of them. The oldest is also the least
  // likely to be where the user is now.
  if (live.length > MAX_LIVE_SPANS) live.shift();
}

function forget(span: ReadableSpan): void {
  const spanId = contextOf(span)?.spanId;
  if (!spanId) return;
  const at = live.findIndex((open) => open.spanId === spanId);
  if (at !== -1) live.splice(at, 1);
}

/**
 * One warning per reason, not per span: a failing join fails on every span,
 * and a console with a thousand copies of a line is a console with none.
 */
function onceEach(): (enabled: boolean, message: string) => void {
  const said = new Set<string>();
  return (enabled, message) => {
    if (!enabled || said.has(message)) return;
    said.add(message);
    console.warn(message);
  };
}

let warnAmbiguous = onceEach();

/**
 * The join that owns `session.id`: the first one created with a `session`.
 *
 * Two recorders on a page (RUM and PostHog, say) each have a session, and a
 * span has one `session.id`. Letting both assign it makes it whichever ran
 * last, and letting both write the baggage flips the header between them on
 * every span. So the first join owns `session.id` and the baggage; every other
 * one records its id as `<name>.session.id`, so no recording is unreachable.
 * Keyed by name, so a framework re-creating the same join keeps ownership.
 */
let sessionOwner: string | undefined;

/**
 * Which span each request ran in, keyed by the request object itself: the
 * `XMLHttpRequest` (what axios hands back as `error.request`) or the fetch
 * `Response`. Filled by full mode's fetch and XHR instrumentation as each
 * request ends. A WeakMap, so it holds nothing the page has let go of.
 */
const requestSpans = new WeakMap<WeakKey, SpanContext>();

/**
 * @internal Called by full mode as each traced request completes.
 *
 * Also takes the span off the list of spans in flight. The XHR
 * instrumentation keeps a span open for up to ~300ms after the response, to
 * collect its resource timing. A request that has answered is not what the
 * user is inside, so it stops counting as in flight when it answers, and an
 * error after a few quick clicks still resolves. Errors from the request
 * itself find it through the request object.
 */
export function rememberRequestSpan(
  request: WeakKey | undefined,
  spanContext: SpanContext,
): void {
  if (request) requestSpans.set(request, spanContext);
  const at = live.findIndex((open) => open.spanId === spanContext.spanId);
  if (at !== -1) live.splice(at, 1);
}

/**
 * The span of the request an error came from, if it carries one.
 *
 * Reads where HTTP clients put it: the value itself (an `XMLHttpRequest` or
 * `Response`), `.request` (axios: the XHR), `.response` (ky, ofetch, axios'
 * response, whose `.request` is the XHR), and `.cause` (`new Error(msg, {
 * cause: response })`). A failed request's error is usually handled after the
 * request's span has ended (a TanStack Query `onError`, a `catch` after
 * `await`), when neither the active context nor the spans in flight know about
 * it; the request object does.
 */
export function spanContextOf(value: unknown): SpanContext | undefined {
  const seen = new Set<unknown>();
  const visit = (
    record: UnknownRecord | undefined,
    depth: number,
  ): SpanContext | undefined => {
    if (!record || depth > 3 || seen.has(record)) return undefined;
    seen.add(record);
    const own = requestSpans.get(record);
    if (own) return own;
    for (const key of ['request', 'response', 'cause']) {
      let next: UnknownRecord | undefined;
      try {
        next = asRecord(record[key]);
      } catch {
        continue;
      }
      const found = visit(next, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(asRecord(value), 0);
}

export interface CurrentSpanContextOptions {
  /**
   * Explain, once, why an event got no trace id because more than one trace
   * was in flight. Defaults to on in development, off in production.
   */
  debug?: boolean;
  /** Appended to that explanation: how to fix it with the caller's own API. */
  hint?: string;
  /**
   * The error being reported. If it came from a traced request, that
   * request's span is the answer, ahead of whatever else is active or in
   * flight: see {@link spanContextOf}.
   */
  error?: unknown;
}

/**
 * The span the user is inside right now, for stamping onto a vendor's event.
 *
 * The span of the request `options.error` came from, when it came from one.
 * Otherwise the active context when there is one. The browser has no
 * AsyncLocalStorage, though, so after the first `await`, where an error
 * tracker or analytics call fires, the active context is root again.
 * Then this falls back to the newest span still in flight, as seen by any
 * `enrichSpans()` processor on the page.
 *
 * Returns `undefined` when more than one trace is in flight: two overlapping
 * clicks each start their own trace, so "the newest" there is a wrong trace,
 * not a wrong span, and no id beats an id that links an unrelated request.
 */
export function currentSpanContext(
  options: CurrentSpanContextOptions = {},
): SpanContext | undefined {
  const fromError =
    options.error === undefined ? undefined : spanContextOf(options.error);
  if (fromError) return fromError;

  const active = trace.getSpanContext(context.active());
  if (active) return active;

  const newest = live.at(-1);
  if (!newest) return undefined;

  if (live.some((open) => open.traceId !== newest.traceId)) {
    warnAmbiguous(
      options.debug ?? isDevelopment(),
      '[autotel-web] An event has no trace id: it fired after the browser ' +
        'lost the active span, while more than one trace was in flight, so ' +
        'which one it belongs to is unknowable. Read the span context before ' +
        'the first await and pass it along yourself.' +
        (options.hint ? ` ${options.hint}` : ''),
    );
    return undefined;
  }

  return newest;
}

export interface EnrichSpansOptions {
  /** Names this join in diagnostics: `[autotel-web:<name>]`. */
  name: string;

  /**
   * The id the vendor keys its recordings on.
   *
   * Assigned to `session.id`, not filled: where a recorder has a session, its
   * id outranks the one the tracer minted, because it is the one a replay can
   * be opened by. Also copied onto same-origin fetches as W3C baggage when it
   * changes (see `propagateSession`).
   *
   * With several joins on a page, the first one created owns `session.id` and
   * the baggage; the others record theirs as `<name>.session.id`.
   */
  session?: () => string | undefined;

  /**
   * Copy `session` onto subsequent same-origin fetches as W3C `baggage`, so
   * the server span of a traced request carries `session.id` too. The backend
   * needs `init({ baggage: '' })` for the attribute to land under that name.
   *
   * @default true
   */
  propagateSession?: boolean;

  /**
   * Attributes known when the span starts: who the user is, which flag
   * variant they saw. Read at the start because they are facts about when the
   * operation ran; identity can change before a long span ends.
   *
   * Filled, never overwritten: a span that set an attribute itself knows
   * something this join does not.
   */
  onStart?: (span: Span) => Attributes | undefined;

  /**
   * Attributes worth adding only to a failed span, such as a replay link.
   * Healthy spans never get them, and neither does a span whose `session`
   * rotated while it ran, since the link would open a different recording.
   *
   * Return a string instead to say, once in development, why there is
   * nothing to add ("replay is not recording").
   */
  onFailure?: (span: ReadableSpan) => Attributes | string | undefined;

  /**
   * Explain, once per reason, why a failed span got no `onFailure`
   * attributes. Every exit on that path is a missing attribute and nothing
   * else, which looks exactly like a working join while you wire it up.
   *
   * @default true in development, false in production
   */
  debug?: boolean;
}

/**
 * A span enricher for `initFull({ spanEnrichers })` that joins one vendor.
 *
 * Every read is guarded: a vendor SDK that throws, or is still the loader
 * snippet's stub, costs the span an attribute, never the span. It also keeps
 * `currentSpanContext()` able to answer after an `await`.
 */
export function enrichSpans(options: EnrichSpansOptions): SpanProcessor {
  const debug = options.debug ?? isDevelopment();
  const warnOnce = onceEach();
  const explain = (reason: string): void =>
    warnOnce(
      debug,
      `[autotel-web:${options.name}] No failure attributes on a failed span: ${reason}`,
    );

  const read = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };

  const readSession = (): string | undefined => {
    if (!options.session) return undefined;
    // An SDK that has not finished initializing answers with ''.
    const id = asString(read(options.session));
    return id && id.length > 0 ? id : undefined;
  };

  if (options.session && sessionOwner === undefined) {
    sessionOwner = options.name;
  }
  // The owner's session is the page's session, for every signal: spans and
  // baggage here, and logs and events through the shared session provider.
  // Set again by a re-created owner, so the provider reads the live instance.
  if (options.session && sessionOwner === options.name) {
    setJoinSessionProvider(() => readSession());
  }
  const sessionKey = (): string =>
    sessionOwner === options.name ? 'session.id' : `${options.name}.session.id`;

  let lastPropagated: string | undefined;
  /**
   * Called at construction as well as on every span: the baggage header is
   * decided before the fetch span exists, so waiting for `onStart` would send
   * the page's first request without it. Still called per span, because the
   * SDK may not have loaded yet and sessions rotate.
   */
  const propagate = (sessionId: string | undefined): void => {
    if (options.propagateSession === false) return;
    if (sessionOwner !== options.name) return;
    if (!sessionId || sessionId === lastPropagated) return;
    lastPropagated = sessionId;
    read(() => setBaggage({ 'session.id': sessionId }));
  };

  propagate(readSession());

  return {
    onStart(span: Span): void {
      remember(span);

      const sessionId = readSession();
      if (sessionId !== undefined) span.setAttribute(sessionKey(), sessionId);
      propagate(sessionId);

      const extra = options.onStart && read(() => options.onStart!(span));
      if (extra) {
        // SAFETY: ReadableSpan types attributes as readonly; an enricher's
        // job is to add to them before the exporter, which runs after it.
        const attributes = span.attributes as Attributes;
        fill(attributes, extra, span);
      }
    },

    onEnd(span: ReadableSpan): void {
      forget(span);
      // A span that started while the owning SDK had no session yet carries
      // a stand-in id; the visit's session is known now, so file it there.
      if (sessionOwner === options.name) {
        // SAFETY: as below, an enricher adds to attributes before export.
        const own = span.attributes as Attributes;
        const id = asString(own['session.id']);
        if (id) own['session.id'] = settledSessionId(id);
      }
      if (!options.onFailure || !failed(span)) return;

      // SAFETY: ReadableSpan types attributes as readonly; an enricher's job
      // is to add to them before the exporter, which runs after it.
      const attributes = span.attributes as Attributes;
      if (options.session) {
        // No session at all is left to `onFailure`, which knows why (the SDK
        // is missing, or still loading) better than a "rotated" would say.
        const current = readSession();
        if (current !== undefined && current !== attributes[sessionKey()]) {
          explain(
            'the session changed after this span started, so a link would ' +
              'open a different recording than the one the span belongs to.',
          );
          return;
        }
      }

      const result = read(() => options.onFailure!(span));
      // `typeof`, not a helper: `onFailure` returns attributes or a reason,
      // and TypeScript has to follow the narrowing into the other arm.
      if (typeof result === 'string') {
        explain(result);
        return;
      }
      if (result) fill(attributes, result);
    },

    forceFlush: () => Promise.resolve(),
    shutdown: () => {
      live.length = 0;
      return Promise.resolve();
    },
  };
}

function fill(attributes: Attributes, extra: Attributes, span?: Span): void {
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || attributes[key] !== undefined) continue;
    if (span) {
      // SAFETY: `undefined` was skipped above, and what remains of an
      // `Attributes` value is an AttributeValue.
      span.setAttribute(key, value as AttributeValue);
    } else {
      attributes[key] = value;
    }
  }
}

/** @internal How many spans are being held. Lets a test prove the bound. */
export function liveSpanCountForTesting(): number {
  return live.length;
}

/** @internal */
export function resetJoinForTesting(): void {
  live.length = 0;
  warnAmbiguous = onceEach();
  sessionOwner = undefined;
  setJoinSessionProvider(undefined);
}
