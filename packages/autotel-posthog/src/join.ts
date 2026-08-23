/**
 * One call, both directions.
 *
 * The two halves of the join are configured in different places — the enricher
 * belongs to the tracer, the `before_send` hook belongs to PostHog — and asking
 * for two edits in two files is how an integration ends up half-wired. This
 * takes the PostHog instance, wires the PostHog half itself, and hands back the
 * enricher for the tracer half:
 *
 * ```ts
 * import posthog from 'posthog-js';
 * import { joinPostHog } from 'autotel-posthog';
 *
 * posthog.init('<key>');
 * initFull({ service: 'web', endpoint, spanEnrichers: [joinPostHog(posthog)] });
 * ```
 */

import type { SpanContext } from '@opentelemetry/api';
import type {
  ReadableSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { setBaggage } from 'autotel-web/baggage';
import {
  autotelBeforeSend,
  type AutotelBeforeSendOptions,
  type BeforeSendLike,
} from './before-send';
import {
  posthogCompatibility,
  resolvePostHog,
  type PostHogCompatibilityOptions,
} from './compatibility';
import { isDevelopment } from './dev-mode';
import { readSessionId, type PostHogLike } from './posthog-like';

/**
 * Marks our hook so a second call recognises it. Framework code runs more than
 * once — strict mode, HMR, a re-render — and a chain that grows on every render
 * stamps the same properties again and again.
 *
 * The marker is not a flag but the hook's registry of live-span lists. Only one
 * hook is ever installed, while every call returns its own processor tracking
 * its own spans — and the app registers whichever one it was handed last. A
 * later call therefore has to join the installed hook's registry rather than
 * keep its spans to itself, or the join stops working after the first
 * re-render, silently, in exactly the frameworks that re-render.
 */
const MARKER = '__autotelBeforeSend';

/** Each entry is one processor's still-open spans, newest last. */
type LiveRegistry = SpanContext[][];

type MarkedHook = BeforeSendLike & { [MARKER]?: LiveRegistry };

/**
 * How many started-but-not-ended spans to keep for the fallback. Deep enough
 * for any real nesting on a page, shallow enough that leaked spans cost
 * nothing.
 */
const MAX_LIVE_SPANS = 128;

function existingHooks(posthog: PostHogLike): BeforeSendLike[] {
  const current = posthog.config?.before_send as
    BeforeSendLike | BeforeSendLike[] | undefined;
  if (Array.isArray(current)) return current;
  return current ? [current] : [];
}

/**
 * Wire PostHog to stamp trace context on its events, and return the span
 * enricher for the other direction.
 *
 * Safe to call more than once, and safe to call on an instance that cannot be
 * configured — the loader snippet's stub has no `set_config`, and the trace
 * side is worth having even when the PostHog side cannot be wired.
 */
export interface JoinPostHogOptions
  extends
    Omit<PostHogCompatibilityOptions, 'posthog'>,
    AutotelBeforeSendOptions {
  /**
   * Copy PostHog's session id onto subsequent same-origin fetches as W3C
   * `baggage`, so the server span of a traced request carries `session.id`.
   * The backend needs `init({ baggage: '' })` for the attribute to land under
   * that name. Distinct id stays off: it can be an email.
   *
   * @default true
   */
  propagateSession?: boolean;
}

export function joinPostHog(
  posthog: PostHogLike | (() => PostHogLike | undefined),
  options: JoinPostHogOptions = {},
): SpanProcessor {
  const resolve = () => resolvePostHog({ ...options, posthog });

  /**
   * Returns true once the hook is in place. Kept retryable because the loader
   * snippet's stub has no `set_config`: giving up at call time would leave
   * every PostHog event on that page without its trace for the life of the
   * page, and the real library usually arrives a moment later.
   */
  const wire = (): boolean => {
    try {
      const instance = resolve();
      if (!instance) return false;

      const hooks = existingHooks(instance) as MarkedHook[];
      // SAFETY: the marker is autotel's own property on a hook autotel
      // installed; a hook from anywhere else simply does not carry it.
      const installed = hooks.find((hook) => hook[MARKER]);
      if (installed) {
        // Already wired, so no second hook — but this call's processor may be
        // the one the app registers, so point at the registry the running hook
        // reads. Spans already in flight move across with it.
        const shared = installed[MARKER];
        if (shared && shared !== registry) {
          const wasJoined = registry.includes(live);
          leave();
          registry = shared;
          if (wasJoined) join();
        }
        return true;
      }
      if (typeof instance.set_config !== 'function') return false;

      const hook = autotelBeforeSend({
        ...options,
        fallbackSpanContext,
      }) as MarkedHook;
      // SAFETY: marking our own hook so a second joinPostHog() adopts it
      // instead of installing another.
      hook[MARKER] = registry;
      // Appended, never assigned: `before_send` is a chain the page may already
      // use to redact or drop events, and replacing it would switch that off.
      instance.set_config({
        before_send: [...hooks, hook],
      } as Parameters<NonNullable<PostHogLike['set_config']>>[0]);
      return true;
    } catch {
      // A PostHog that cannot be configured is still one worth reading from.
      return false;
    }
  };

  /**
   * Spans that have started and not yet ended, newest last.
   *
   * The browser drops the active context at the first `await`, so by the time
   * the fetch fails and the page captures the event, `context.active()` is
   * root again. These are the spans still in flight, and the newest of them is
   * the one the user is inside — the same answer the active context would have
   * given, recovered from what the processor already sees.
   *
   * An array, not a single slot: spans do not end in the order they start, and
   * an inner span ending must not erase the outer one that is still open.
   * Concurrent *sibling* spans are the one case this cannot tell apart, and it
   * picks the most recent — a wrong span in the same trace, never a wrong
   * trace.
   */
  const live: SpanContext[] = [];

  /**
   * The registry the installed hook reads. Starts as this call's own and is
   * replaced by the installed hook's the moment `wire()` finds one, so every
   * call ends up pointing at the same list.
   */
  let registry: LiveRegistry = [];

  /**
   * Membership is earned by having a span, not by existing.
   *
   * Every re-render calls `joinPostHog` again and only the processor the app
   * registers is ever handed a span — so a slot per call is a slot per render,
   * growing what each PostHog capture has to walk and holding it for the life
   * of the page. Joining on the first span and leaving on the last keeps the
   * registry the size of what is actually in flight.
   */
  const join = (): void => {
    if (!registry.includes(live)) registry.push(live);
  };

  const leave = (): void => {
    const at = registry.indexOf(live);
    if (at !== -1) registry.splice(at, 1);
  };

  let warnedAmbiguous = false;

  const fallbackSpanContext = (): SpanContext | undefined => {
    // Across every processor that joined this hook, not just this one's: an
    // unregistered processor contributes an empty list, so the union is
    // exactly the spans actually in flight.
    const open = registry.flat();
    const newest = open.at(-1);
    if (!newest) return undefined;

    // More than one trace in flight, and no active context to say which one
    // this event belongs to. Two clicks in quick succession do exactly this:
    // each `span()` with no parent starts its own trace, so "the most recent"
    // is not a wrong span but a wrong trace, and whoever follows it lands in
    // an unrelated request. Nothing is better than wrong here.
    if (open.some((candidate) => candidate.traceId !== newest.traceId)) {
      if ((options.debug ?? isDevelopment()) && !warnedAmbiguous) {
        warnedAmbiguous = true;
        console.warn(
          '[autotel-posthog] No $trace_id on a PostHog event: more than one ' +
            'trace was in flight and the browser had already lost the active ' +
            'context, so which one this event belongs to is unknowable. ' +
            'Fix: read traceProperties() before the first await and spread it ' +
            'onto the capture — ' +
            'const t = traceProperties(); ... posthog.capture(name, { ...t }).',
        );
      }
      return undefined;
    }

    return newest;
  };

  /**
   * Same defensiveness as every other read here: a processor that throws on a
   * span it did not expect takes the span down with it.
   */
  const contextOf = (span: ReadableSpan): SpanContext | undefined => {
    try {
      return typeof span.spanContext === 'function'
        ? span.spanContext()
        : undefined;
    } catch {
      return undefined;
    }
  };

  const remember = (span: ReadableSpan): void => {
    const spanContext = contextOf(span);
    if (!spanContext) return;
    join();
    live.push(spanContext);
    // Not every span that starts ends: a page can navigate away mid-span, and
    // an SPA that does it a thousand times would otherwise pin every one of
    // them for the life of the tab. The oldest is also the least likely to be
    // where the user is now, so it is the safest one to forget.
    if (live.length > MAX_LIVE_SPANS) live.shift();
  };

  const forget = (span: ReadableSpan): void => {
    const spanId = contextOf(span)?.spanId;
    if (!spanId) return;
    const at = live.findIndex((candidate) => candidate.spanId === spanId);
    if (at !== -1) live.splice(at, 1);
    if (live.length === 0) leave();
  };

  let wired = wire();
  const enricher = posthogCompatibility({ ...options, posthog });
  let lastPropagated: string | undefined;

  /**
   * Copy PostHog's session id into baggage, once per session.
   *
   * Called at construction as well as on every span, because the baggage
   * header is decided before the span exists: the wrapped fetch checks for
   * baggage and only then hands off to the instrumented fetch that opens the
   * span. Waiting for `onStart` means the page's first request leaves without
   * `session.id` and only later ones carry it — and with no application span
   * around the call, that is every first request.
   *
   * Still called from `onStart` too: at construction PostHog may be the loader
   * snippet's stub with nothing to read yet, and sessions rotate after 30
   * minutes idle.
   */
  const propagate = (): void => {
    if (options.propagateSession === false) return;
    try {
      const instance = resolve();
      if (!instance) return;
      const sessionId = readSessionId(instance);
      if (!sessionId || sessionId === lastPropagated) return;
      lastPropagated = sessionId;
      setBaggage({ 'session.id': sessionId });
    } catch {
      // Analytics that cannot write baggage must not take down the span.
    }
  };

  propagate();

  // Typed wider than the declared return so the internal counter below is not
  // an excess property; callers only ever see a SpanProcessor.
  const processor: SpanProcessor & {
    liveCount: () => number;
    registeredCount: () => number;
  } = {
    onStart(span, context) {
      remember(span);
      // Every span is another chance to catch the library once it has loaded.
      if (!wired) wired = wire();
      enricher.onStart(span, context);
      propagate();
    },
    onEnd: (span) => {
      forget(span);
      enricher.onEnd(span);
    },
    forceFlush: () => enricher.forceFlush(),
    shutdown: () => {
      // A processor being torn down has nothing in flight worth consulting.
      live.length = 0;
      leave();
      return enricher.shutdown();
    },
    /**
     * How many spans the fallback is holding. Bookkeeping, exposed so a test
     * can prove the bound holds; nothing reads it at runtime.
     * @internal
     */
    liveCount: () => live.length,
    /**
     * How many processors currently have spans in flight. Bookkeeping, exposed
     * so a test can prove repeated calls do not accumulate.
     * @internal
     */
    registeredCount: () => registry.length,
  };

  return processor;
}
