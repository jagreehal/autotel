/**
 * The browser round trip, against a real Sentry project.
 *
 * `autotel-sentry`'s contract test proves the join against the real
 * `@sentry/browser` with no network. This proves what only a live project can:
 * that the error Sentry ingests carries the autotel trace id, and that the
 * browser and server spans arrive under that same trace.
 *
 *   SENTRY_AUTH_TOKEN=sntryu_... SENTRY_ORG=my-org node smoke-web.mjs
 *
 * Without SENTRY_DSN it skips. Without a token it checks only the page.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { SENTRY_DSN, SENTRY_AUTH_TOKEN, SENTRY_ORG } = process.env;
const API = process.env.SENTRY_API ?? 'https://us.sentry.io/api/0';

if (!SENTRY_DSN) {
  console.log('SKIP: SENTRY_DSN is not set, nothing to smoke-test against.');
  process.exit(0);
}

const failures = [];
const check = (ok, description, detail = '') => {
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${description}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures.push(description);
};

const server = spawn('node', ['--import', 'tsx', 'src/web/server.ts'], {
  cwd: dir,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));
process.on('exit', () => server.kill('SIGTERM'));

for (let attempt = 0; !serverLog.includes('Open http://'); attempt += 1) {
  if (server.exitCode !== null || attempt > 60) {
    console.error(serverLog);
    process.exit(1);
  }
  await sleep(500);
}
const url = serverLog.match(/Open (http:\/\/\S+)/)[1];

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleLines = [];
page.on('console', (message) => consoleLines.push(message.text()));
await page.goto(url);
await page.click('#checkout');
await page.waitForFunction(() =>
  document.getElementById('out')?.textContent?.includes('trace_id'),
);
const out = await page.textContent('#out');
console.log(out);
// Let the batch span processor and Sentry's transport send.
await sleep(4000);
await browser.close();

const traceId = out.match(/trace_id: ([0-9a-f]{32})/)?.[1];
const eventId = out.match(/sentry event: ([0-9a-f]{32})/)?.[1];
check(Boolean(traceId), 'the page has a trace id');
check(Boolean(eventId), 'Sentry captured the error');
check(
  /sentry\.replay_id: [0-9a-f]{32}/.test(out),
  'the span carries the recording replay id',
);
check(
  !consoleLines.some((line) => line.includes('[autotel-')),
  'no autotel diagnostics in the console',
  consoleLines.filter((line) => line.includes('[autotel-')).join(' | '),
);

if (!SENTRY_AUTH_TOKEN || !SENTRY_ORG) {
  console.log(
    'SKIP live checks: set SENTRY_AUTH_TOKEN and SENTRY_ORG to read events back.',
  );
} else if (traceId) {
  const query = async (dataset, fields) => {
    const params = new URLSearchParams({
      dataset,
      query: `trace:${traceId}`,
      statsPeriod: '1h',
    });
    for (const field of fields) params.append('field', field);
    const response = await fetch(
      `${API}/organizations/${SENTRY_ORG}/events/?${params}`,
      {
        headers: { authorization: `Bearer ${SENTRY_AUTH_TOKEN}` },
      },
    );
    if (!response.ok)
      throw new Error(
        `${dataset}: ${response.status} ${await response.text()}`,
      );
    return (await response.json()).data ?? [];
  };

  // Spans and errors take up to a minute or so to become queryable.
  let errors = [];
  let spans = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(10_000);
    errors = await query('errors', ['id', 'title', 'trace']);
    spans = await query('spans', ['span.name', 'project', 'sentry.replay_id']);
    const names = spans.map((s) => s['span.name']);
    if (
      errors.length &&
      names.includes('checkout.click') &&
      names.includes('POST /checkout')
    )
      break;
  }
  // OTLP spans carry their name in span.name; span.description is Sentry's own.
  const names = spans.map((s) => s['span.name']);
  check(
    errors.length > 0,
    'the Sentry error is on the autotel trace',
    errors.map((e) => e.title).join(', '),
  );
  check(
    names.includes('checkout.click'),
    'the browser span reached Sentry over OTLP',
  );
  check(
    names.includes('POST /checkout'),
    'the server span is in the same trace',
  );
  check(
    spans.some((s) => s['sentry.replay_id']),
    'Sentry indexed sentry.replay_id on the browser spans',
  );
  console.log(
    `trace: https://${SENTRY_ORG}.sentry.io/explore/traces/trace/${traceId}/`,
  );
}

process.exit(failures.length ? 1 : 0);
