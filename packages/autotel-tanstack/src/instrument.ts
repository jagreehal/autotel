/**
 * Configurable tracing setup for TanStack Start.
 *
 * `instrument(options)` is a thin wrapper over autotel's `init` that adds the
 * TanStack defaults so apps don't hand-roll them:
 *
 * - service name defaults to `OTEL_SERVICE_NAME` or `'tanstack-start'`;
 * - `debug` resolves from `AUTOTEL_DEBUG` (`pretty` in dev when no endpoint set);
 * - when `E2E=1`, spans are captured by an `InMemorySpanExporter` exposed as
 *   `globalThis.__testSpanExporter` (for span assertions) instead of shipping
 *   over OTLP;
 * - it's idempotent — a second call is a no-op.
 *
 * Everything else — `endpoint`, `headers`, `subscribers`, `logs`,
 * `canonicalLogLines`, extra `spanProcessors`, … — passes straight through to
 * `init`, and the standard `OTEL_*` env vars are resolved by autotel core, so
 * apps never re-parse them.
 *
 * The zero-config `autotel-tanstack/auto` side-effect module is just
 * `instrument()` with no options.
 *
 * @example
 * ```ts
 * import { instrument } from 'autotel-tanstack';
 * import { PostHogSubscriber } from 'autotel-subscribers';
 *
 * instrument({
 *   subscribers: process.env.POSTHOG_KEY
 *     ? [new PostHogSubscriber({ apiKey: process.env.POSTHOG_KEY })]
 *     : [],
 *   logs: true,
 *   canonicalLogLines: { enabled: true, rootSpansOnly: true },
 * });
 * ```
 *
 * @module
 */

import { init, isInitialized, type AutotelConfig } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

// `service` is optional here — instrument() defaults it to OTEL_SERVICE_NAME or
// 'tanstack-start'. Everything else matches autotel's init config.
export type InstrumentOptions = Omit<AutotelConfig, 'service'> & {
  service?: string;
};

const DEFAULT_SERVICE = 'tanstack-start';

/**
 * Resolve span-debug output: an explicit option wins; otherwise `AUTOTEL_DEBUG`
 * (`pretty` | `true`/`1` | `false`/`0`); otherwise pretty-print in development
 * when there's no OTLP endpoint, so spans are visible immediately.
 */
function resolveDebug(
  explicit: AutotelConfig['debug'],
  endpoint: string | undefined,
): boolean | 'pretty' {
  if (explicit !== undefined) return explicit;
  const env = process.env.AUTOTEL_DEBUG;
  if (env === 'pretty') return 'pretty';
  if (env === 'true' || env === '1') return true;
  if (env === 'false' || env === '0') return false;
  if (!endpoint && process.env.NODE_ENV === 'development') return 'pretty';
  return false;
}

export function instrument(options: InstrumentOptions = {}): void {
  // Idempotent: tolerate the instrumentation module being evaluated more than
  // once (HMR, multiple entry points) without re-initializing.
  if (isInitialized()) return;

  const service =
    options.service ?? process.env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE;

  if (process.env.E2E === '1') {
    // Capture spans in memory for test assertions; skip OTLP/logs entirely.
    const exporter = new InMemorySpanExporter();
    (globalThis as Record<string, unknown>).__testSpanExporter = exporter;
    init({
      service,
      subscribers: options.subscribers,
      spanProcessors: [
        new SimpleSpanProcessor(exporter),
        ...(options.spanProcessors ?? []),
      ],
    });
    return;
  }

  init({
    ...options,
    service,
    debug: resolveDebug(options.debug, options.endpoint),
  });
}
