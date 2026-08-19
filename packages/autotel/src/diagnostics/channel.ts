/**
 * Edge-safe wrappers over Node's `diagnostics_channel`.
 *
 * The module is loaded lazily through {@link safeRequire} — never a static
 * `node:` import — so merely importing this file is side-effect-free and bundles
 * cleanly for browser/edge targets, where every subscribe call degrades to a
 * no-op (returning an unsubscribe that does nothing). This is the shared
 * primitive behind autotel's diagnostics-channel integrations (console capture,
 * HTTP spans) and any app- or library-specific channel you want to bridge into
 * a span/event.
 *
 * `diagnostics_channel.subscribe` (Node 18.7+) and `tracingChannel` (Node 19+)
 * are used; autotel targets Node 22+, but on any runtime that lacks them the
 * loader returns `undefined` and the helpers no-op.
 */

import { safeRequire } from '../node-require.js';

type DiagnosticsChannelModule = typeof import('node:diagnostics_channel');

let cached: DiagnosticsChannelModule | null | undefined;

function loadDiagnosticsChannel(): DiagnosticsChannelModule | undefined {
  if (cached !== undefined) return cached ?? undefined;
  cached =
    safeRequire<DiagnosticsChannelModule>('node:diagnostics_channel') ?? null;
  return cached ?? undefined;
}

/** Whether Node's `diagnostics_channel` is available in this runtime. */
export function diagnosticsChannelAvailable(): boolean {
  return loadDiagnosticsChannel() !== undefined;
}

/**
 * Handler for a plain named channel. `TMessage` is whatever the publisher on
 * that channel sends - a subscriber that knows the channel says so; one that
 * does not gets `unknown` and decodes it itself.
 */
export type ChannelMessageHandler<TMessage = unknown> = (
  message: TMessage,
  name: string | symbol,
) => void;

/**
 * Subscribe to a named diagnostics channel. Returns an idempotent unsubscribe
 * function; a no-op (that still returns a disposer) on unsupported runtimes.
 */
export function subscribeChannel<TMessage = unknown>(
  name: string,
  handler: ChannelMessageHandler<TMessage>,
): () => void {
  const dc = loadDiagnosticsChannel();
  if (!dc?.subscribe) return () => {};
  // SAFETY: TMessage is the subscriber's own claim about what this channel
  // publishes. Node hands the listener whatever was published - the claim is
  // the caller's to make, and theirs to get wrong.
  const listener = handler as ChannelMessageHandler;
  dc.subscribe(name, listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    dc.unsubscribe?.(name, listener);
  };
}

/** Subscriber set for a {@link https://nodejs.org/api/diagnostics_channel.html#class-tracingchannel TracingChannel}. */
export interface TracingChannelHandlers<TMessage = unknown> {
  start?(message: TMessage): void;
  end?(message: TMessage): void;
  asyncStart?(message: TMessage): void;
  asyncEnd?(message: TMessage): void;
  error?(message: TMessage): void;
}

/**
 * Subscribe to a `tracingChannel` (the `tracing:${name}:{start,end,…}` set).
 * Returns an idempotent unsubscribe; a no-op on runtimes without
 * `tracingChannel` support.
 */
export function subscribeTracingChannel<TMessage = unknown>(
  name: string,
  handlers: TracingChannelHandlers<TMessage>,
): () => void {
  const dc = loadDiagnosticsChannel();
  const channel = dc?.tracingChannel?.(name);
  if (!channel) return () => {};
  // SAFETY: Node's typings want all five handlers on the object passed in;
  // this passes whichever subset the caller supplied, which is what the
  // channel actually does with it - each is called only if present.
  const subset = handlers as Parameters<typeof channel.subscribe>[0];
  channel.subscribe(subset);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    channel.unsubscribe(subset);
  };
}
