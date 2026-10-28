/**
 * The browser round trip, against a real Datadog org.
 *
 * Drives the page in Chromium, then checks two things:
 *
 * - what Datadog RUM actually sends (through its real `beforeSend` and field
 *   allowlist): the checkout error carries the autotel trace in `context`;
 * - what Datadog ingested: the browser and server spans on one trace, the
 *   browser span carrying the RUM session and the release, and the uncaught
 *   error grouped as an Error Tracking issue.
 *
 *   DATADOG_API_KEY=… DATADOG_SITE=datadoghq.eu DD_APP_KEY=… node smoke-web.mjs
 *
 * Without DD_RUM_APPLICATION_ID / DD_RUM_CLIENT_TOKEN, RUM posts to this
 * server instead of Datadog and the RUM half is checked locally. Without
 * DD_APP_KEY the Datadog half is skipped.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.DATADOG_API_KEY ?? process.env.DD_API_KEY;
const site = process.env.DATADOG_SITE ?? process.env.DD_SITE ?? 'datadoghq.com';
const appKey = process.env.DD_APP_KEY;
const startedAt = Date.now();

if (!apiKey) {
  console.log('SKIP: DATADOG_API_KEY is not set.');
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
process.on('exit', (code) => {
  if (code !== 0)
    console.error(`--- server log ---\n${serverLog.slice(-3000)}`);
  server.kill('SIGTERM');
});
for (let attempt = 0; !serverLog.includes('Open http://'); attempt += 1) {
  if (server.exitCode !== null || attempt > 60) {
    console.error(serverLog);
    process.exit(1);
  }
  await sleep(500);
}
const url = serverLog.match(/Open (http:\/\/\S+)/)[1];
const liveRum = serverLog.includes('RUM: live');

const browser = await chromium.launch();
const page = await browser.newPage();
const diagnostics = [];
page.on(
  'console',
  (m) => m.text().includes('[autotel-') && diagnostics.push(m.text()),
);
page.on('pageerror', () => {}); // the Throw button's error is the point
// What the page did with RUM's uploads through the local proxy.
const exportedUrls = [];
let rumUploadsWithBaggage = 0;
page.on('request', (request) => {
  if (request.url().includes('/rum-intake') && request.headers().baggage) {
    rumUploadsWithBaggage += 1;
  }
  if (!request.url().includes('/otel/v1/traces')) return;
  const body = JSON.parse(request.postData() ?? '{}');
  for (const resource of body.resourceSpans ?? [])
    for (const scope of resource.scopeSpans ?? [])
      for (const span of scope.spans ?? [])
        for (const a of span.attributes ?? [])
          if (a.key === 'url.full' || a.key === 'http.url')
            exportedUrls.push(a.value.stringValue);
});
await page.goto(url);
await page.click('#checkout');
await page.waitForFunction(() =>
  document.getElementById('out')?.textContent?.includes('trace_id'),
);
const out = await page.textContent('#out');
console.log(out);
await page.click('#throw');
// What a RUM upload through the proxy looks like to autotel, made while the
// page is alive (RUM itself uploads on a 30s timer, or as an unload beacon).
await page.evaluate(() =>
  fetch('/rum-intake?ddforward=/api/v2/rum%3Fddsource%3Dbrowser', {
    method: 'POST',
    body: '',
  }).catch(() => {}),
);
await sleep(1500);
// Leaving the page is what flushes both RUM's batch and autotel's.
await page.goto('about:blank');
await sleep(2000);
await browser.close();

const traceId = out.match(/trace_id: ([0-9a-f]{32})/)?.[1];
const rumSession = out.match(/rum session: ([0-9a-f-]{36})/)?.[1];
check(Boolean(traceId), 'the page has a trace id');
check(Boolean(rumSession), 'RUM started a session');
check(
  diagnostics.length === 0,
  'no autotel diagnostics in the console',
  diagnostics.join(' | '),
);
check(
  !exportedUrls.some((u) => u.includes('/rum-intake')),
  'RUM’s uploads through the proxy are not traced',
);
check(
  rumUploadsWithBaggage === 0,
  'and get no baggage',
  `${rumUploadsWithBaggage}`,
);

if (liveRum) {
  console.log('RUM is live: its events are in Datadog, not checked here.');
} else {
  const events = await (await fetch(new URL('/rum-events', url))).json();
  const errors = events.filter((e) => e.type === 'error');
  const checkout = errors.find(
    (e) => e.error?.message === 'Checkout failed: 402',
  );
  check(Boolean(checkout), 'RUM sent the checkout error');
  check(
    checkout?.context?.trace_id === traceId,
    'the RUM error carries the autotel trace id',
    checkout?.context?.trace_id,
  );
  check(
    /^\d+$/.test(checkout?.context?.span_id ?? ''),
    'and the span id in Datadog’s decimal form',
    checkout?.context?.span_id,
  );
  check(
    checkout?.context?.trace_url === `https://app.${site}/apm/trace/${traceId}`,
    'and the link to the trace',
  );
  check(
    errors.some(
      (e) =>
        e.error?.source === 'source' && /reading "total"/.test(e.error.message),
    ),
    'RUM sent the uncaught error too',
  );
}

if (!appKey) {
  console.log(
    'SKIP Datadog checks: set DD_APP_KEY to read spans and issues back.',
  );
} else if (traceId) {
  const api = (route, body) =>
    fetch(`https://api.${site}${route}`, {
      method: 'POST',
      headers: {
        'DD-API-KEY': apiKey,
        'DD-APPLICATION-KEY': appKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  // Span search is limited to 5 requests a minute; poll gently.
  let spans = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(20_000);
    const result = await api('/api/v2/spans/events/search', {
      data: {
        type: 'search_request',
        attributes: {
          filter: { query: `trace_id:${traceId}`, from: 'now-30m', to: 'now' },
          page: { limit: 20 },
        },
      },
    });
    spans = result.data ?? [];
    const names = spans.map((s) => s.attributes.resource_name);
    if (names.includes('checkout.click') && names.includes('POST /checkout'))
      break;
  }
  const byName = (name) =>
    spans.find((s) => s.attributes.resource_name === name)?.attributes;
  const click = byName('checkout.click');
  check(
    Boolean(click),
    'the browser span reached Datadog through the relay',
    click?.service,
  );
  check(
    Boolean(byName('POST /checkout')),
    'the server span is in the same trace',
  );
  check(
    click?.custom?.session?.id === rumSession,
    'the browser span carries the RUM session',
    click?.custom?.session?.id,
  );
  check(click?.custom?.user?.id === 'usr_example', 'and the RUM user');
  // The same defaults src/web/server.ts uses.
  const version = process.env.VERSION ?? '1.0.0';
  const environment = process.env.ENVIRONMENT ?? 'example';
  check(
    click?.custom?.version === version && click?.custom?.env === environment,
    'and the release and environment',
    `${click?.custom?.version} / ${click?.custom?.env}`,
  );

  let issue;
  for (let attempt = 0; attempt < 10 && !issue; attempt += 1) {
    const result = await api(
      '/api/v2/error-tracking/issues/search?include=issue',
      {
        data: {
          type: 'search_request',
          attributes: {
            query: 'service:example-datadog-web',
            from: startedAt - 86_400_000,
            to: Date.now(),
            track: 'trace',
          },
        },
      },
    );
    issue = (result.included ?? []).find((i) =>
      /reading "total"/.test(i.attributes.error_message ?? ''),
    );
    if (!issue) await sleep(30_000);
  }
  check(
    Boolean(issue),
    'the uncaught error is a Datadog Error Tracking issue',
    issue?.attributes?.error_message,
  );
  console.log(`trace: https://app.${site}/apm/trace/${traceId}`);
}

process.exit(failures.length ? 1 : 0);
