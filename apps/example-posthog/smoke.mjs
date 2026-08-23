/**
 * The round trip, against a real PostHog project.
 *
 * `src/*.test.ts` in the packages proves the join against a real `posthog-js`
 * with no network. This proves the part that only a live project can: that the
 * properties survive ingestion and come back out of PostHog under the names
 * the docs promise. Both of the bugs this example was written to reproduce
 * were invisible to a green unit suite.
 *
 *   POSTHOG_KEY=phc_... node smoke.mjs
 *
 * Skips, rather than fails, with no key — so a fork without secrets is green.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.POSTHOG_KEY) {
  console.log('SKIP: POSTHOG_KEY is not set, nothing to smoke-test against.');
  process.exit(0);
}

const failures = [];
const check = (ok, description, detail = '') => {
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${description}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures.push(description);
};

const server = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
  cwd: dir,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverLog.includes('Open http://')) return;
    if (server.exitCode !== null) {
      throw new Error(`server exited early:\n${serverLog}`);
    }
    await sleep(500);
  }
  throw new Error(`server never came up:\n${serverLog}`);
}

let browser;
try {
  await waitForServer();
  check(
    serverLog.includes('PostHog: live'),
    'server picked up POSTHOG_KEY',
    serverLog.match(/PostHog: \w+/)?.[0],
  );

  browser = await chromium.launch();
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));

  await page.goto('http://localhost:8787', { waitUntil: 'load' });
  await sleep(2500);

  // posthog-js drops headless Chrome as bot traffic *before* before_send runs.
  // Without this the page would report every property missing and the run
  // would look like a regression in the join rather than in the harness.
  await page.evaluate(() =>
    window.posthog.set_config({ opt_out_useragent_filter: true }),
  );

  // Past the 10s look-back posthog-js subtracts, so a non-zero `?t=` proves
  // the replay link deep-links to the failure rather than the session start.
  await sleep(12_000);
  await page.click('#checkout');
  await sleep(7000);

  const output = await page.textContent('#out');
  console.log(`\n${output}\n`);

  const read = (label) =>
    output.match(new RegExp(`^${label}: (.+)$`, 'm'))?.[1]?.trim();

  const sessionId = read('session.id');
  const traceId = read('\\$trace_id');
  const spanId = read('\\$span_id');
  const replayUrl = read('session.replay.url');

  check(problems.length === 0, 'page threw nothing', problems.join('; '));
  check(
    /^[0-9a-f-]{20,}$/.test(sessionId ?? ''),
    'span carries session.id',
    sessionId,
  );

  // The join itself: an event captured after `await fetch(...)`, where the
  // browser has already lost the active span.
  check(
    /^[0-9a-f]{32}$/.test(traceId ?? ''),
    'event carries $trace_id',
    traceId,
  );
  check(/^[0-9a-f]{16}$/.test(spanId ?? ''), 'event carries $span_id', spanId);

  // The server hop, via W3C baggage and `init({ baggage: '' })`.
  check(
    serverLog.includes(`baggage header: session.id=${sessionId}`),
    'server received session.id as baggage',
  );
  check(
    new RegExp(`session\\.id=${sessionId}[,\\s]`).test(serverLog),
    'server span carries session.id',
  );

  // Replay is a project setting, so absence is legitimate. A link to the wrong
  // session, or one that does not deep-link, is not.
  if (replayUrl && replayUrl !== '(missing)') {
    check(replayUrl.includes(sessionId), 'replay link points at this session');
    check(
      /\?t=[1-9]/.test(replayUrl),
      'replay link deep-links to the failure',
      replayUrl,
    );
  } else {
    console.log('note  session replay is off for this project, link skipped');
  }
} catch (cause) {
  check(
    false,
    'smoke test ran',
    cause instanceof Error ? cause.message : String(cause),
  );
} finally {
  await browser?.close();
  stop();
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`,
  );
  process.exit(1);
}
console.log('\nAll checks passed.');
process.exit(0);
