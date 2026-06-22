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

/** Handler for a plain named channel. */
export type ChannelMessageHandler = (
  message: unknown,
  name: string | symbol,
) => void;

/**
 * Subscribe to a named diagnostics channel. Returns an idempotent unsubscribe
 * function; a no-op (that still returns a disposer) on unsupported runtimes.
 */
export function subscribeChannel(
  name: string,
  handler: ChannelMessageHandler,
): () => void {
  const dc = loadDiagnosticsChannel();
  if (!dc?.subscribe) return () => {};
  dc.subscribe(name, handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    dc.unsubscribe?.(name, handler);
  };
}

/** Subscriber set for a {@link https://nodejs.org/api/diagnostics_channel.html#class-tracingchannel TracingChannel}. */
export interface TracingChannelHandlers {
  start?(message: unknown): void;
  end?(message: unknown): void;
  asyncStart?(message: unknown): void;
  asyncEnd?(message: unknown): void;
  error?(message: unknown): void;
}

/**
 * Subscribe to a `tracingChannel` (the `tracing:${name}:{start,end,…}` set).
 * Returns an idempotent unsubscribe; a no-op on runtimes without
 * `tracingChannel` support.
 */
export function subscribeTracingChannel(
  name: string,
  handlers: TracingChannelHandlers,
): () => void {
  const dc = loadDiagnosticsChannel();
  const channel = dc?.tracingChannel?.(name);
  if (!channel) return () => {};
  // Node's typings want all five handlers; we pass the subset provided.
  channel.subscribe(handlers as Parameters<typeof channel.subscribe>[0]);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    channel.unsubscribe(handlers as Parameters<typeof channel.unsubscribe>[0]);
  };
}
