/**
 * Normalise an OTLP HTTP trace endpoint.
 *
 * `init()` accepted a bare origin and appended the path, while `initFull()`
 * passed the value straight to the exporter — so the same `endpoint` config
 * meant two different things and a bare origin silently 404'd in full mode.
 * Both now share this.
 */
const TRACES_PATH = '/v1/traces';
const LOGS_PATH = '/v1/logs';

export function normaliseOtlpEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith(TRACES_PATH) ? trimmed : `${trimmed}${TRACES_PATH}`;
}

/** OTLP signals this package exports. */
export type OtlpSignal = 'traces' | 'logs';

/**
 * The endpoint for one signal. Callers configure a single `endpoint`, which may
 * already carry the traces path; the signal path is swapped rather than
 * appended, so `https://host/v1/traces` still yields `https://host/v1/logs`.
 */
export function otlpEndpointFor(endpoint: string, signal: OtlpSignal): string {
  const base = normaliseOtlpEndpoint(endpoint).slice(0, -TRACES_PATH.length);
  return `${base}${signal === 'logs' ? LOGS_PATH : TRACES_PATH}`;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Whether the whole of the collector's origin may be excluded.
 *
 * Only the application knows. A collector that serves its UI and query API
 * beside `/v1/traces` owns its origin, and every request to it is telemetry;
 * an OTLP endpoint proxied through the application's own server owns nothing,
 * and excluding that origin would silence the app. Nothing in the URL tells the
 * two apart - a loopback port is as likely to be a dev API server as a
 * collector - so this is a declaration (`collectorOwnsOrigin`), never a guess.
 *
 * The page's own origin is never excluded whatever the declaration says: the
 * application is always the majority of what is served there.
 */
function ownsWholeOrigin(
  collectorOwnsOrigin: boolean,
  collector: URL,
  page: URL | undefined,
): boolean {
  if (!collectorOwnsOrigin) return false;
  return page === undefined || originKey(collector) !== originKey(page);
}

/** Origin key in which the loopback aliases name one host. */
function originKey(url: URL): string {
  const host = LOOPBACK_HOSTS.has(url.hostname) ? 'localhost' : url.hostname;
  return `${url.protocol}//${host}:${url.port}`;
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * URLs the browser instrumentations must not trace.
 *
 * Without this the exporter's own POST to the collector is traced, producing a
 * span, which is exported, which produces another span. The loop floods the
 * collector and starves real spans out of the batch buffer.
 *
 * Both OTLP paths are excluded, and by default nothing else: a collector shares
 * its origin with whatever else that host serves - `api.example.com/otlp` sits
 * beside `api.example.com/orders`, and a dev endpoint proxied through
 * `localhost:3000/otlp` sits beside that server's own API - so excluding the
 * origin would silence the very requests the page exists to make.
 *
 * With `collectorOwnsOrigin`, the application declares that nothing else lives
 * there and the whole origin is excluded. That is the case worth declaring for
 * a collector that serves its own UI and query API: the widget displaying the
 * traces is itself a request from this page, and tracing it makes the tool a
 * source of the data it displays. Both loopback spellings are then covered,
 * because one dev collector is routinely named `localhost` in `.env` and
 * `127.0.0.1` in the widget.
 */
export function selfInstrumentationIgnoreUrls(
  endpoint: string | undefined,
  pageOrigin?: string,
  collectorOwnsOrigin = false,
): RegExp[] {
  if (endpoint === undefined) return [];
  // Anchored on the resolved URL so a same-origin `/v1/traces` cannot match
  // some other host's, and closed at a query or fragment rather than at the
  // end of the string, since the exporter may append neither or both.
  const otlpPaths = (['traces', 'logs'] as const).map((signal) => {
    const path = otlpEndpointFor(endpoint, signal);
    try {
      const resolved = new URL(path, pageOrigin || undefined).href;
      return new RegExp(`^${escapeRegExp(resolved)}(?:[?#]|$)`, 'i');
    } catch {
      // A relative endpoint with no page origin: match the path as written.
      return new RegExp(`${escapeRegExp(path)}(?:[?#]|$)`, 'i');
    }
  });
  if (pageOrigin === undefined && !collectorOwnsOrigin) return otlpPaths;

  let collector: URL;
  let page: URL | undefined;
  try {
    collector = new URL(
      normaliseOtlpEndpoint(endpoint),
      pageOrigin || undefined,
    );
  } catch {
    return otlpPaths;
  }
  try {
    // No page origin to protect - the declaration stands on its own.
    page = pageOrigin === undefined ? undefined : new URL(pageOrigin);
  } catch {
    page = undefined;
  }
  if (!ownsWholeOrigin(collectorOwnsOrigin, collector, page)) return otlpPaths;

  // Both loopback spellings name one host; anything else names only itself.
  const hosts = LOOPBACK_HOSTS.has(collector.hostname)
    ? [...LOOPBACK_HOSTS]
    : [collector.hostname];
  return hosts.map(
    (host) =>
      new RegExp(
        `^${escapeRegExp(`${collector.protocol}//${host}${collector.port ? `:${collector.port}` : ''}`)}(?:[/?#]|$)`,
        'i',
      ),
  );
}

/**
 * True when `url` is a call to the collector this page exports to, which the
 * browser instrumentations must not trace.
 *
 * {@link selfInstrumentationIgnoreUrls} covers the exporter's own POST. This
 * covers the rest of the collector: a dev collector serves its UI and query API
 * beside `/v1/traces`, and tracing those calls makes the tool a source of the
 * data it displays — every poll of the trace list writes another trace to the
 * list, and the real spans are pushed out by the noise.
 *
 * A collector is matched by its OTLP paths, because excluding a whole origin
 * would silence the application's own API whenever the two share a host —
 * `endpoint: ''`, a production endpoint like `api.example.com/otlp` beside
 * `api.example.com/orders`, or a dev endpoint proxied through the app's own
 * server on `localhost:3000`.
 *
 * `collectorOwnsOrigin` is the application declaring that nothing else is
 * served there, and only then is the whole origin excluded, with the loopback
 * aliases compared equal — one dev collector is routinely named `localhost` in
 * `.env` and `127.0.0.1` in the widget that reads it.
 */
export function isSelfTelemetryUrl(
  url: string,
  endpoint: string | undefined,
  pageOrigin: string,
  collectorOwnsOrigin = false,
): boolean {
  if (endpoint === undefined) return false;

  let target: URL;
  let collector: URL;
  try {
    target = new URL(url, pageOrigin || undefined);
    collector = new URL(
      normaliseOtlpEndpoint(endpoint),
      pageOrigin || undefined,
    );
  } catch {
    return false;
  }

  if (originKey(target) !== originKey(collector)) return false;

  let page: URL | undefined;
  try {
    page = new URL(pageOrigin);
  } catch {
    page = undefined;
  }
  if (ownsWholeOrigin(collectorOwnsOrigin, collector, page)) return true;

  const pathFor = (signal: OtlpSignal) =>
    new URL(otlpEndpointFor(endpoint, signal), pageOrigin || undefined)
      .pathname;
  return (
    target.pathname === pathFor('traces') || target.pathname === pathFor('logs')
  );
}
