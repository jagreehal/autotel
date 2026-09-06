/**
 * Runs the three services, sends traffic through them, then prints what the
 * collector actually stored.
 *
 *   pnpm start              collector decides  -> whole traces survive
 *   pnpm start:in-process   each service decides -> orphan spans survive
 *
 * Both runs send identical traffic to the same collector config. The only
 * difference is where the sampling decision is made.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

const TRACES_FILE = fileURLToPath(
  new URL('../out/traces.json', import.meta.url),
);
const SERVICE = fileURLToPath(new URL('./service.ts', import.meta.url));
const ROLES = ['inventory', 'checkout', 'gateway'] as const;
const REQUESTS = [
  '/checkout',
  '/checkout',
  '/checkout?fail=1',
  '/checkout',
  '/checkout?fail=1',
  '/checkout',
];

// decision_wait (5s) plus the collector's batch timeout, plus slack.
const COLLECTOR_SETTLE_MS = 8000;

const inProcess = process.env.IN_PROCESS_SAMPLING === '1';

async function main() {
  // The collector appends to traces.json and holds the file open. Deleting or
  // truncating it here would leave the collector writing to an unlinked inode,
  // so mark where this run starts instead and read from there.
  const startOffset = sizeOf(TRACES_FILE);

  console.log(
    inProcess
      ? '\nSampling in each service (autotel production preset, 0% baseline)\n'
      : '\nSampling in the collector (services export everything)\n',
  );

  const children = ROLES.map(start);
  try {
    await Promise.all([3001, 3002, 3003].map(waitForPort));

    let failed = 0;
    for (const path of REQUESTS) {
      const response = await fetch(`http://127.0.0.1:3001${path}`);
      if (path.includes('fail=1')) failed++;
      // Every request returns 200. checkout-service falls back to a cached
      // price, so the failure never surfaces upstream.
      if (!response.ok) throw new Error(`gateway returned ${response.status}`);
      await response.json();
    }

    console.log(
      `${REQUESTS.length} requests sent, all returned 200, ${failed} hit a failing inventory lookup\n`,
    );
  } finally {
    await Promise.all(children.map(stop));
  }

  console.log(
    `Waiting ${COLLECTOR_SETTLE_MS / 1000}s for the collector to decide...\n`,
  );
  await delay(COLLECTOR_SETTLE_MS);

  report(startOffset);
}

function start(role: string): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', SERVICE], {
    env: { ...process.env, ROLE: role },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

/** A bare TCP connect, so waiting for startup does not itself produce a trace. */
async function waitForPort(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    await delay(100);
  }
  throw new Error(`service on :${port} never came up`);
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Everything the collector appended since this run began. */
function readSince(path: string, offset: number): string | undefined {
  const length = sizeOf(path) - offset;
  if (length <= 0) return undefined;

  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

type StoredSpan = { traceId: string; service: string; start: bigint };

function report(startOffset: number): void {
  const raw = readSince(TRACES_FILE, startOffset);
  if (!raw) {
    console.log(
      'No traces stored. Is the collector running? `docker compose up -d`\n',
    );
    return;
  }

  const traces = new Map<string, StoredSpan[]>();
  for (const span of parse(raw)) {
    const spans = traces.get(span.traceId) ?? [];
    spans.push(span);
    traces.set(span.traceId, spans);
  }

  console.log('Traces the collector stored:\n');
  for (const [traceId, spans] of traces) {
    spans.sort((a, b) => (a.start < b.start ? -1 : 1));
    const shape = spans.map((s) => s.service).join(' -> ');
    const count = `${spans.length} span${spans.length === 1 ? '' : 's'}`;
    console.log(`  ${traceId.slice(0, 8)}…  ${count.padEnd(8)}  ${shape}`);
  }

  const orphaned = [...traces.values()].filter((s) => s.length === 1).length;
  console.log(
    inProcess
      ? `\n${orphaned} of ${traces.size} stored traces are a single orphan span.\n` +
          'api-gateway and checkout-service each decided, correctly and locally,\n' +
          'that their own work succeeded, and dropped the spans that would have\n' +
          'shown how the request reached inventory-service.\n\n' +
          'Now run: pnpm start\n'
      : `\n${traces.size} traces stored, all three services present in each.\n` +
          'The collector held every span until the trace finished, saw that one\n' +
          'span had failed, and kept the trace whole. The healthy requests were\n' +
          'dropped whole, so there are no half traces either way.\n\n' +
          'Now run: pnpm start:in-process\n',
  );
}

/** Reads the OTLP JSON the collector's file exporter writes, one batch per line. */
function* parse(raw: string): Generator<StoredSpan> {
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const batch = JSON.parse(line) as {
      resourceSpans?: {
        resource?: {
          attributes?: { key: string; value?: { stringValue?: string } }[];
        };
        scopeSpans?: {
          spans?: { traceId: string; startTimeUnixNano: string }[];
        }[];
      }[];
    };

    for (const resourceSpan of batch.resourceSpans ?? []) {
      const service =
        resourceSpan.resource?.attributes?.find((a) => a.key === 'service.name')
          ?.value?.stringValue ?? 'unknown';

      for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
        for (const span of scopeSpan.spans ?? []) {
          yield {
            traceId: span.traceId,
            service,
            start: BigInt(span.startTimeUnixNano),
          };
        }
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
