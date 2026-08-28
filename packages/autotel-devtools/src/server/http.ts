// src/server/http.ts
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJsonBody,
  readRawBody,
  isProtobufContentType,
  sendJson,
} from './otlp';
import {
  decodeOtlpTraceRequest,
  decodeOtlpLogsRequest,
  decodeOtlpMetricsRequest,
} from './otlp-proto';
import { DEVTOOLS_IDENTITY } from './identity';
import { allowSensitiveRequest } from './origin-guard';
import { readSourceWindow } from './source-file';
import type { DevtoolsServer } from './server';
import { joinCoverage, type MapRoute } from './coverage/coverage';

type OtlpSignal = 'traces' | 'logs' | 'metrics';

// Reply to a failed OTLP ingest. Echoing the content-type we received turns the
// otherwise opaque "Invalid OTLP payload" into something a misconfigured
// exporter can act on (e.g. it shows up as `null` when no header was sent, or
// as a protobuf type the sender didn't expect to be using).
function sendOtlpError(
  res: ServerResponse,
  req: IncomingMessage,
  e: unknown,
): void {
  sendJson(res, 400, {
    error: 'Invalid OTLP payload',
    message: e instanceof Error ? e.message : String(e),
    contentType: req.headers['content-type'] ?? null,
  });
}

const PROTOBUF_DECODERS: Record<
  OtlpSignal,
  (body: Buffer) => Record<string, unknown>
> = {
  traces: decodeOtlpTraceRequest,
  logs: decodeOtlpLogsRequest,
  metrics: decodeOtlpMetricsRequest,
};

// Read an OTLP request body as a plain object, transparently decoding both
// OTLP/JSON (`application/json`) and OTLP/protobuf (`application/x-protobuf`).
// Both shapes feed the same parsers, so callers don't care which the client sent.
async function readOtlpPayload(
  req: IncomingMessage,
  signal: OtlpSignal,
): Promise<unknown> {
  if (isProtobufContentType(req.headers['content-type'])) {
    return PROTOBUF_DECODERS[signal](await readRawBody(req));
  }
  return readJsonBody(req);
}

export interface HttpServerOptions {
  port?: number;
  host?: string;
}

function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return dir;
}

const DEVTOOLS_FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f172a"/><text x="32" y="41" text-anchor="middle" font-size="32">🛰️</text></svg>';

/**
 * The title is user-supplied (`--title` / `AUTOTEL_DEVTOOLS_TITLE`) and lands
 * inside `<title>`, where an unescaped `<` would close the element early.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderFullpageHtml(title = 'autotel-devtools'): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;width:100%;overflow:hidden}</style></head><body><script src="/widget.js?mode=fullpage"></script></body></html>`;
}

let cachedVersion: string | null = null;
function getVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  let version = 'unknown';
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(findPackageRoot(), 'package.json'), 'utf8'),
    );
    if (typeof pkg.version === 'string') version = pkg.version;
  } catch {
    /* keep 'unknown' */
  }
  cachedVersion = version;
  return version;
}

const widgetJsCache = new Map<string, string>();

/**
 * The browser bundle for one surface.
 *
 * Two are built: `fullpage.global.js` carries every view, while
 * `widget.global.js` is the reduced set for embedding in someone else's page.
 * Serving the right one is what makes the split worth anything — handing the
 * full bundle to an embedder would ship them the views the split exists to
 * spare them.
 *
 * The full-page bundle falls back to the widget one when it is missing, so a
 * partially-built checkout still serves a working UI rather than a comment.
 */
function getWidgetJs(surface: 'widget' | 'fullpage'): string {
  const cached = widgetJsCache.get(surface);
  if (cached) return cached;

  const pkgRoot = findPackageRoot();
  const names =
    surface === 'fullpage'
      ? ['fullpage.global.js', 'widget.global.js']
      : ['widget.global.js'];
  const candidates = names.flatMap((name) => [
    resolve(pkgRoot, 'dist', name),
    resolve(pkgRoot, name),
  ]);

  let contents: string | null = null;
  for (const candidate of candidates) {
    try {
      contents = readFileSync(candidate, 'utf8');
      break;
    } catch {
      /* try next */
    }
  }
  const resolved =
    contents ?? '// widget bundle not found - run pnpm build first';
  widgetJsCache.set(surface, resolved);
  return resolved;
}

export interface DevtoolsRoutesOptions {
  /** Bound to a loopback host (the default). Enables the DNS-rebinding `Host`
   *  check on read endpoints; an explicit non-loopback bind opts out. */
  loopbackOnly?: boolean;
  /** Browser tab title for the fullpage UI. Without it every dashboard reads
   *  `autotel-devtools`, which is unhelpful with several running at once. */
  title?: string;
  /**
   * Project root that `GET /source` may read from, so a stack frame can show
   * the line that threw.
   *
   * Opt-in and absent by default: without it the route 404s and devtools never
   * touches the filesystem. Reading is confined to this directory, symlinks
   * included — see `resolveWithinRoot`.
   */
  sourceRoot?: string;
}

export function attachDevtoolsRoutes(
  httpServer: Server,
  devtools: DevtoolsServer,
  options: DevtoolsRoutesOptions = {},
): void {
  const loopbackOnly = options.loopbackOnly ?? true;
  const sourceRoot = options.sourceRoot;
  const fullpageHtml = renderFullpageHtml(options.title);
  httpServer.on(
    'request',
    async (req: IncomingMessage, res: ServerResponse) => {
      // WebSocket upgrade requests are handled by the 'upgrade' event (via the
      // ws library's WebSocketServer). Responding here would close the connection
      // before the upgrade can complete.
      if (req.headers.upgrade?.toLowerCase() === 'websocket') return;

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, DELETE, OPTIONS',
      );
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Identity stamp on every response: lets a client confirm it is really
      // talking to autotel-devtools (and not, say, an IDE's OTLP collector that
      // happens to share the port) without guessing from the body shape.
      res.setHeader('x-autotel-devtools', getVersion());
      res.setHeader('Access-Control-Expose-Headers', 'x-autotel-devtools');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url || '/';

      // GET / — fullpage HTML
      if (req.method === 'GET' && url === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(fullpageHtml),
        });
        res.end(fullpageHtml);
        return;
      }

      // GET /widget.js — widget bundle
      if (req.method === 'GET' && url.startsWith('/widget.js')) {
        // The full-page HTML asks for `?mode=fullpage`; an embedder's script
        // tag does not, and gets the reduced bundle.
        const js = getWidgetJs(
          url.includes('mode=fullpage') ? 'fullpage' : 'widget',
        );
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Length': Buffer.byteLength(js),
        });
        res.end(js);
        return;
      }

      if (
        req.method === 'GET' &&
        (url === '/favicon.svg' || url === '/favicon.ico')
      ) {
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'Content-Length': Buffer.byteLength(DEVTOOLS_FAVICON_SVG),
        });
        res.end(DEVTOOLS_FAVICON_SVG);
        return;
      }

      if (
        req.method === 'GET' &&
        url.split('?')[0] === '/api/query/attributes'
      ) {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const params = new URL(url, 'http://localhost').searchParams;
        const signal = params.get('signal') === 'logs' ? 'logs' : 'traces';
        // `key` + `pair` ask a different question from `value`: not "which
        // field holds this text" but "which values does this field take, and
        // which value of that other field was on the same span". That is what
        // lets the viewer offer an experiment's own arms instead of asking the
        // reader to know them.
        const key = params.get('key');
        const pair = params.get('pair');
        if (key !== null && pair !== null) {
          sendJson(res, 200, {
            pairs: devtools.pairedAttributeValues(signal, key, pair),
          });
          return;
        }
        sendJson(res, 200, {
          attributes: devtools.searchAttributes(
            signal,
            params.get('value') ?? '',
          ),
        });
        return;
      }

      // GET /healthz — also the canonical identity probe: `service` + `version`
      // let a caller positively confirm this is autotel-devtools.
      // GET /source?file=&line=&context= — the few lines around a stack frame.
      //
      // Reads the developer's disk, so it is gated three ways: opt-in via
      // `sourceRoot`, the same loopback/Origin guard as the other read
      // endpoints, and containment inside the root (symlinks resolved).
      // A refusal is always 404, never 403-with-detail: "outside the root",
      // "not a file" and "does not exist" must be indistinguishable, or the
      // route becomes a filesystem oracle.
      if (req.method === 'GET' && url.split('?')[0] === '/source') {
        if (!sourceRoot) {
          sendJson(res, 404, { error: 'Not found' });
          return;
        }
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }

        const query = new URL(url, 'http://localhost').searchParams;
        const file = query.get('file');
        const line = Number(query.get('line'));
        // `context` is clamped rather than rejected — an absurd value is a
        // caller bug, not an attack, and 0 is legitimate (just the one line).
        const context = Math.min(
          Math.max(Number(query.get('context') ?? 5) || 0, 0),
          50,
        );

        if (!file || !Number.isInteger(line) || line < 1) {
          sendJson(res, 400, {
            error: 'file and a positive integer line are required',
          });
          return;
        }

        const window = readSourceWindow(sourceRoot, file, line, context);
        if (window === null) {
          sendJson(res, 404, { error: 'Not found' });
          return;
        }
        sendJson(res, 200, { ...window });
        return;
      }

      if (req.method === 'GET' && url === '/healthz') {
        sendJson(res, 200, {
          ok: true,
          service: DEVTOOLS_IDENTITY,
          version: getVersion(),
          clients: devtools.clientCount,
        });
        return;
      }

      // GET /v1/traces — read back what the collector has actually received.
      // This is the verification primitive for tests: poll the collector over
      // HTTP and assert receipt, instead of only asserting "the client tried to
      // send" (which a browser-level route intercept can fake). Bypasses the UI's
      // WebSocket entirely.
      if (req.method === 'GET' && url === '/v1/traces') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const data = devtools.getCurrentData();
        sendJson(res, 200, { traces: data.traces, count: data.traces.length });
        return;
      }

      // DELETE /v1/traces — clear captured telemetry (test isolation / reset).
      // Clears traces, logs, metrics and aggregated errors so each test starts clean.
      if (req.method === 'DELETE' && url === '/v1/traces') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        devtools.clearData();
        sendJson(res, 200, { cleared: true });
        return;
      }

      if (
        req.method === 'DELETE' &&
        (url === '/v1/logs' || url === '/v1/metrics')
      ) {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const signal = url.endsWith('/logs') ? 'logs' : 'metrics';
        devtools.clearSignal(signal);
        sendJson(res, 200, { cleared: true, signal });
        return;
      }

      if (req.method === 'DELETE' && url === '/api/traces') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const body = (await readJsonBody(req)) as { traceIds?: string[] };
        const traceIds = Array.isArray(body.traceIds)
          ? body.traceIds.filter((id): id is string => typeof id === 'string')
          : [];
        sendJson(res, 200, { deleted: devtools.deleteTraces(traceIds) });
        return;
      }

      // POST /v1/traces — accepts OTLP/JSON or OTLP/protobuf
      if (req.method === 'POST' && url === '/v1/traces') {
        try {
          const payload = await readOtlpPayload(req, 'traces');
          const acceptedTraces = devtools.ingestOtlp('traces', payload);
          sendJson(res, 200, { acceptedTraces });
        } catch (e) {
          sendOtlpError(res, req, e);
        }
        return;
      }

      // POST /v1/logs — accepts OTLP/JSON or OTLP/protobuf
      if (req.method === 'POST' && url === '/v1/logs') {
        try {
          const payload = await readOtlpPayload(req, 'logs');
          const acceptedLogs = devtools.ingestOtlp('logs', payload);
          sendJson(res, 200, { acceptedLogs });
        } catch (e) {
          sendOtlpError(res, req, e);
        }
        return;
      }

      // POST /v1/metrics — accepts OTLP/JSON or OTLP/protobuf
      if (req.method === 'POST' && url === '/v1/metrics') {
        try {
          const payload = await readOtlpPayload(req, 'metrics');
          const acceptedMetrics = devtools.ingestOtlp('metrics', payload);
          sendJson(res, 200, { acceptedMetrics });
        } catch (e) {
          sendOtlpError(res, req, e);
        }
        return;
      }

      if (
        req.method === 'GET' &&
        (url === '/api/query/traces/fields' || url === '/api/query/logs/fields')
      ) {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const signal = url.includes('/logs/') ? 'logs' : 'traces';
        sendJson(res, 200, { fields: devtools.listQueryFields(signal) });
        return;
      }

      // POST /api/query/traces — run a query against the durable store.
      //
      // Sensitive: it reads captured telemetry, so it takes the same
      // origin guard as the other read-back routes. A parse failure is a 400
      // with positioned errors (the editor draws squiggles from them), not a
      // 500 — a half-typed query is expected input, not a server fault.
      if (req.method === 'POST' && url === '/api/query/traces') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        try {
          const body = (await readJsonBody(req)) as {
            query?: string;
            window?: { start: number; end: number };
            limit?: number;
            cursor?: string;
          };
          const result = devtools.queryTraces({
            query: body.query ?? '',
            window: body.window,
            limit: body.limit,
            cursor: body.cursor,
          });
          if (result.errors) {
            sendJson(res, 400, { errors: result.errors });
            return;
          }
          sendJson(res, 200, {
            traces: result.traces,
            nextCursor: result.nextCursor,
          });
        } catch (e) {
          sendJson(res, 400, {
            error: 'Invalid query request',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }

      /*
       * Instrumentation coverage: which mapped entry points never emitted.
       *
       * Reads `autotel.map.json`, which `autotel map` writes and projects
       * commit, from the same root `GET /source` reads under — the map
       * describes that tree, so anywhere else would describe someone else's
       * code.
       */
      if (req.method === 'GET' && url === '/api/coverage') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        if (!sourceRoot) {
          sendJson(res, 404, {
            error: 'Coverage unavailable',
            message:
              'No source root configured, so `autotel.map.json` cannot be located.',
          });
          return;
        }
        const mapPath = resolve(sourceRoot, 'autotel.map.json');
        if (!existsSync(mapPath)) {
          // Not an empty report: zero routes and zero *unseen* routes are
          // indistinguishable in a count, and reporting "0 of 0" would tell
          // someone their app is covered when nothing has ever scanned it.
          sendJson(res, 404, {
            error: 'No instrumentation map',
            message:
              "Run `npx autotel map` to record this project's entry points, then reload.",
          });
          return;
        }
        try {
          const parsed = JSON.parse(readFileSync(mapPath, 'utf8')) as {
            routes?: MapRoute[];
          };
          sendJson(
            res,
            200,
            joinCoverage(parsed.routes ?? [], devtools.observedSpans()),
          );
        } catch (e) {
          sendJson(res, 400, {
            error: 'Unreadable instrumentation map',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }

      /*
       * Cohort comparison: what separates these spans from those.
       *
       * The ranking comes from `compareCohorts` in `autotel/analysis`, loaded
       * on demand. `autotel` is a peer dependency, so a viewer pointed at a
       * plain OpenTelemetry SDK may not have it installed — that is a missing
       * feature to report, not a server that fails to start, which is what a
       * top-level import would have made it.
       */
      if (req.method === 'POST' && url === '/api/analysis/compare') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        let compareCohorts;
        try {
          ({ compareCohorts } = await import('autotel/analysis'));
        } catch {
          sendJson(res, 501, {
            error: 'Comparison unavailable',
            message:
              'Install `autotel` alongside autotel-devtools to compare cohorts.',
          });
          return;
        }
        try {
          const body = (await readJsonBody(req)) as {
            outlier?: {
              query?: string;
              window?: { start: number; end: number };
            };
            baseline?: {
              query?: string;
              window?: { start: number; end: number };
            };
            ignoreFields?: string[];
            limit?: number;
          };
          const outlier = devtools.cohortRows({
            query: body.outlier?.query ?? '',
            window: body.outlier?.window,
          });
          const baseline = devtools.cohortRows({
            query: body.baseline?.query ?? '',
            window: body.baseline?.window,
          });
          sendJson(res, 200, {
            differences: compareCohorts({
              outlier,
              baseline,
              ignoreFields: body.ignoreFields,
              limit: body.limit,
            }),
            outlierCount: outlier.length,
            baselineCount: baseline.length,
          });
        } catch (e) {
          sendJson(res, 400, {
            error: 'Invalid comparison request',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }

      // POST /api/query/logs — run a log query against the durable store.
      if (req.method === 'POST' && url === '/api/query/logs') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        try {
          const body = (await readJsonBody(req)) as {
            query?: string;
            window?: { start: number; end: number };
            limit?: number;
            cursor?: string;
          };
          const result = devtools.queryLogs({
            query: body.query ?? '',
            window: body.window,
            limit: body.limit,
            cursor: body.cursor,
          });
          if (result.errors) {
            sendJson(res, 400, { errors: result.errors });
            return;
          }
          sendJson(res, 200, {
            logs: result.logs,
            nextCursor: result.nextCursor,
          });
        } catch (e) {
          sendJson(res, 400, {
            error: 'Invalid query request',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }

      // POST /api/query/errors — aggregate errors from the store for a window.
      if (req.method === 'POST' && url === '/api/query/errors') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        try {
          const body = (await readJsonBody(req)) as {
            query?: string;
            window?: { start: number; end: number };
            limit?: number;
          };
          const result = devtools.queryErrors({
            query: body.query ?? '',
            window: body.window,
            limit: body.limit,
          });
          if (result.errors_parse) {
            sendJson(res, 400, { errors: result.errors_parse });
            return;
          }
          sendJson(res, 200, { errors: result.errors });
        } catch (e) {
          sendJson(res, 400, {
            error: 'Invalid query request',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }

      // GET /api/metrics — the metric catalogue.
      if (req.method === 'GET' && url === '/api/metrics') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        sendJson(res, 200, { metrics: devtools.listMetricNames() });
        return;
      }

      if (req.method === 'GET' && url.split('?')[0] === '/api/metrics') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const query =
          new URL(url, 'http://localhost').searchParams.get('q') ?? '';
        const result = devtools.queryMetricCatalog(query);
        if (result.errors) sendJson(res, 400, { errors: result.errors });
        else sendJson(res, 200, { metrics: result.metrics });
        return;
      }

      if (req.method === 'DELETE' && url.split('?')[0] === '/api/metrics') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const name = new URL(url, 'http://localhost').searchParams.get('name');
        if (!name) {
          sendJson(res, 400, { error: 'A metric name is required' });
          return;
        }
        sendJson(res, 200, { deletedSeries: devtools.deleteMetric(name) });
        return;
      }

      if (req.method === 'GET' && url === '/api/stats') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        sendJson(res, 200, devtools.getStoreStats());
        return;
      }

      if (req.method === 'GET' && url.split('?')[0] === '/api/traces/slowest') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const limit = Number(
          new URL(url, 'http://localhost').searchParams.get('limit') ?? 10,
        );
        sendJson(res, 200, { traces: devtools.findSlowestTraces(limit) });
        return;
      }

      const summaryMatch =
        req.method === 'GET' && url.match(/^\/api\/traces\/([^/?]+)\/summary$/);
      if (summaryMatch) {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const summary = devtools.describeTrace(
          decodeURIComponent(summaryMatch[1]),
        );
        if (!summary) sendJson(res, 404, { error: 'Trace not found' });
        else sendJson(res, 200, summary);
        return;
      }

      // POST /api/query/metrics — the series for one metric, with their points.
      if (req.method === 'POST' && url === '/api/query/metrics') {
        if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        try {
          const body = (await readJsonBody(req)) as {
            name?: string;
            window?: { start: number; end: number };
            maxPoints?: number;
          };
          if (!body.name) {
            sendJson(res, 400, { error: 'A metric name is required' });
            return;
          }
          sendJson(res, 200, {
            series: devtools.queryMetricSeries({
              name: body.name,
              window: body.window,
              maxPoints: body.maxPoints,
            }),
          });
        } catch (e) {
          sendJson(res, 400, {
            error: 'Invalid metrics query',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    },
  );
}

export function createDevtoolsHttpServer(
  devtools: DevtoolsServer,
  _options: HttpServerOptions = {},
): Server {
  const server = createServer();
  attachDevtoolsRoutes(server, devtools);
  return server;
}
