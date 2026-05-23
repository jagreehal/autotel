// Live HTTP + SSE server for the dashboard.
//
// Endpoints:
//   GET /                  → dashboard HTML (served from services/public/live.html)
//   GET /snapshot.json     → current ArchitectureSnapshot
//   GET /drift.json        → current drift report (computed against the static catalog)
//   GET /events            → SSE: streams live events as they fire
//
// No Express, no socket.io — just Node's http module + SSE.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';
import {
  diffCatalogAgainstSnapshot,
  readCatalogState,
  renderMarkdown,
  type DriftReport,
} from 'autotel-eventcatalog';

import type { LiveEvent, LiveStreamSubscriber } from './stream';

const HERE = dirname(fileURLToPath(import.meta.url));
// `services/public/live.html` from `services/src/live/server.ts`
const HTML_PATH = join(HERE, '..', '..', 'public', 'live.html');
const PR_HTML_PATH = join(HERE, '..', '..', 'public', 'pr.html');
// `apps/example-eventcatalog/catalog`
const CATALOG_PATH = join(HERE, '..', '..', '..', 'catalog');

export interface DemoControls {
  triggerDrift: () => void | Promise<void>;
  clearDrift: () => void | Promise<void>;
  burst: () => void | Promise<void>;
}

export interface LiveServerConfig {
  port: number;
  snapshot: ArchitectureSnapshotSubscriber;
  stream: LiveStreamSubscriber;
  controls?: DemoControls;
}

export async function startLiveServer(config: LiveServerConfig): Promise<() => Promise<void>> {
  const { port, snapshot, stream, controls } = config;
  const html = await readFile(HTML_PATH, 'utf8');
  const prHtml = await readFile(PR_HTML_PATH, 'utf8');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      switch (url.pathname) {
        case '/':
          return sendHtml(res, html);
        case '/demo/pr':
        case '/demo/pr.html':
          return sendHtml(res, prHtml);
        case '/snapshot.json':
          return sendJson(res, snapshot.toSnapshot());
        case '/drift.json':
          return sendJson(res, await computeDrift(snapshot));
        case '/drift.md':
          return sendText(res, renderMarkdown(await computeDrift(snapshot)));
        case '/catalog-events.json':
          return sendJson(res, await readCatalogEvents());
        case '/events':
          return handleSse(req, res, stream);
        case '/demo/trigger-drift':
          return handleControl(req, res, controls?.triggerDrift);
        case '/demo/clear-drift':
          return handleControl(req, res, controls?.clearDrift);
        case '/demo/burst':
          return handleControl(req, res, controls?.burst);
        default:
          return sendStatus(res, 404, 'Not found');
      }
    } catch (err) {
      sendStatus(res, 500, (err as Error).message);
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}

async function computeDrift(
  snapshot: ArchitectureSnapshotSubscriber,
): Promise<DriftReport> {
  const catalog = await readCatalogState(CATALOG_PATH);
  return diffCatalogAgainstSnapshot(snapshot.toSnapshot(), catalog);
}

/**
 * Lean view of the catalog's declared events. The dashboard's "declared vs
 * observed" diff panel needs the declared field paths per event id.
 */
async function readCatalogEvents(): Promise<
  Record<string, { id: string; declaredFieldPaths: string[] }>
> {
  const catalog = await readCatalogState(CATALOG_PATH);
  const out: Record<string, { id: string; declaredFieldPaths: string[] }> = {};
  for (const [id, ev] of catalog.events) {
    out[id] = { id, declaredFieldPaths: ev.declaredFieldPaths ?? [] };
  }
  return out;
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendStatus(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

async function handleControl(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (() => void | Promise<void>) | undefined,
): Promise<void> {
  if (req.method !== 'POST') {
    sendStatus(res, 405, 'Method not allowed');
    return;
  }
  if (!handler) {
    sendStatus(res, 503, 'Demo controls not configured');
    return;
  }
  // Fire-and-forget on the server side so a long-running handler does not
  // block the dashboard's responsiveness. Errors are logged but not
  // surfaced; the dashboard reads state from /snapshot.json afterward.
  Promise.resolve(handler()).catch((err) => {
    process.stderr.write(`live demo control failed: ${(err as Error).message}\n`);
  });
  sendJson(res, { ok: true });
}

function handleSse(
  req: IncomingMessage,
  res: ServerResponse,
  stream: LiveStreamSubscriber,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const write = (event: LiveEvent) => {
    res.write(`event: track\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = stream.subscribe(write);

  // Heartbeat so intermediaries do not close the connection on idle.
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15_000);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  req.on('close', close);
  req.on('aborted', close);
}
