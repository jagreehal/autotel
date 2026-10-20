/**
 * Spans that are noise by construction, and the names a route goes by.
 *
 * Kept out of init() so the rules can be read, and tested, on their own.
 */

import { SpanKind, trace, type Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { SpanFilterPredicate } from './filtering-span-processor';

/** A route to ignore: a path prefix (`/api/health`) or a pattern. */
export type IgnoredRoute = string | RegExp;

/**
 * The names a server span gives its route. A route the framework resolved
 * (`http.route`, Next's `next.route`) is the one served, so it is judged
 * alone. Without one, the raw path (`url.path`, or Next's older
 * `http.target`) is judged after the URL parser resolves dot segments, so
 * `/api/health/../admin` is `/admin`.
 */
function routesOf(span: ReadableSpan): string[] {
  const resolved = ['http.route', 'next.route']
    .map((key) => span.attributes[key])
    .filter((value): value is string => typeof value === 'string');
  if (resolved.length > 0) return resolved;
  return ['url.path', 'http.target']
    .map((key) => span.attributes[key])
    .filter((value): value is string => typeof value === 'string')
    .map((path) => normalizePath(path));
}

function normalizePath(path: string): string {
  try {
    return new URL(path, 'http://route.invalid').pathname;
  } catch {
    return path.split('?')[0]!;
  }
}

function matches(route: string, ignored: IgnoredRoute): boolean {
  if (typeof ignored !== 'string') return ignored.test(route);
  // A prefix on a segment boundary: `/api/health` is not `/api/healthcare`.
  const prefix = ignored.replace(/\/+$/, '');
  if (!prefix) return route === '/';
  return route === prefix || route.startsWith(`${prefix}/`);
}

/**
 * Drop server spans for the given routes. A dropped server span is normally
 * the request's local root, so the whole request goes with it.
 */
export function ignoredRoutesFilter(
  routes: readonly IgnoredRoute[],
): SpanFilterPredicate {
  // A `g` or `y` regex keeps its place between test() calls, so the same
  // route would match on one request and miss on the next. Test a copy
  // without those flags, which also leaves the caller's regex untouched.
  const ignored = routes.map((route) =>
    typeof route === 'string'
      ? route
      : new RegExp(route.source, route.flags.replaceAll(/[gy]/g, '')),
  );
  return (span) =>
    span.kind !== SpanKind.SERVER ||
    !routesOf(span).some((route) =>
      ignored.some((pattern) => matches(route, pattern)),
    );
}

/** Next.js reports its anonymous usage telemetry here. */
const NEXT_TELEMETRY_HOST = 'telemetry.nextjs.org';
const UNDICI_SCOPE = '@opentelemetry/instrumentation-undici';

function hostOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Whether a span is an outbound call to Next's telemetry host, by its URL or
 * its name. A server span's URL carries the Host header the client sent, so a
 * server span is never judged by it.
 */
function isNextTelemetry(span: ReadableSpan): boolean {
  if (span.kind === SpanKind.SERVER) return false;
  const url = span.attributes['url.full'] ?? span.attributes['http.url'];
  const named = /https?:\/\/\S+/.exec(span.name)?.[0];
  return (
    hostOf(url) === NEXT_TELEMETRY_HOST || hostOf(named) === NEXT_TELEMETRY_HOST
  );
}

/**
 * Next.js fetch noise: a filter, and the processor that tells it which fetch
 * spans are duplicates. Both go in the pipeline.
 *
 * - Next's `AppRender.fetch` span is dropped only when an undici span started
 *   under it: then the two describe one call, and undici's moves up to the
 *   fetch span's parent. Undici being registered proves nothing; it can be
 *   registered and trace nothing, and Next's span is then the only record.
 * - Next's own telemetry call is the framework's, not the app's.
 */
export function nextFetchNoise(): {
  filter: SpanFilterPredicate;
  recorder: SpanProcessor;
} {
  // Keyed by the span object, so an entry goes with its span; read by every
  // exporter's filter, so never cleared on read.
  const duplicated = new WeakSet<object>();
  const recorder: SpanProcessor = {
    onStart(span: Span, parentContext: Context) {
      if (span.instrumentationScope.name !== UNDICI_SCOPE) return;
      const parent = trace.getSpan(parentContext);
      if (parent) duplicated.add(parent);
    },
    onEnd() {},
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
  const filter: SpanFilterPredicate = (span) =>
    !isNextTelemetry(span) &&
    !(
      span.attributes['next.span_type'] === 'AppRender.fetch' &&
      duplicated.has(span)
    );
  return { filter, recorder };
}

/**
 * A span name without the query string or fragment of any URL in it. Next
 * names fetch spans `fetch GET https://host/path?account_id=...`: one name
 * per id, and ids in a field redaction does not read.
 */
export function stripUrlQuery(name: string): string {
  return name.replaceAll(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1');
}
