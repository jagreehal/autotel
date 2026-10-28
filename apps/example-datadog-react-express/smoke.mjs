/**
 * Drives every failure in the app in Chromium, then checks each layer the
 * page is running (it says which in #layers):
 *
 * - traces, always: exported through the relay, and with DD_APP_KEY, the
 *   checkout trace in Datadog holding both the browser and the API;
 * - whichever tool owns errors gets each error once, on the trace of the
 *   request that failed: autotel spans (Datadog Error Tracking), RUM errors,
 *   or PostHog `$exception`s;
 * - the tools that do not own errors stay quiet about them;
 * - each recorder's session is on the spans.
 *
 *   pnpm dev                     # API :8082, web :5174
 *   DD_APP_KEY=… node smoke.mjs  # WEB_URL to point at another instance
 */
import 'dotenv/config';
import { gunzipSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const url = process.env.WEB_URL ?? 'http://localhost:5174';
const apiKey = process.env.DATADOG_API_KEY;
const site = process.env.DATADOG_SITE ?? 'datadoghq.com';
const appKey = process.env.DD_APP_KEY;
const startedAt = Date.now();

const failures = [];
const check = (ok, description, detail = '') => {
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${description}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures.push(description);
};

/** posthog-js batches, gzip-compressed or plain, as a list of events. */
function posthogEvents(request) {
  try {
    let buffer = request.postDataBuffer();
    if (!buffer) return [];
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer);
    const body = JSON.parse(buffer.toString('utf8'));
    return Array.isArray(body) ? body : (body.batch ?? [body]);
  } catch {
    return [];
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const spans = [];
const logSessions = [];
const posthog = [];
const diagnostics = [];
const relayStatus = {};
page.on(
  'console',
  (m) => m.text().includes('[autotel-') && diagnostics.push(m.text()),
);
page.on('pageerror', () => {}); // the thrown errors are the point
page.on('request', (request) => {
  const target = request.url();
  if (target.includes('/otel/v1/logs')) {
    const body = JSON.parse(request.postData() ?? '{}');
    for (const resource of body.resourceLogs ?? [])
      for (const scope of resource.scopeLogs ?? [])
        for (const record of scope.logRecords ?? [])
          logSessions.push(
            record.attributes?.find((a) => a.key === 'session.id')?.value
              ?.stringValue,
          );
  }
  if (target.includes('/otel/v1/traces')) {
    const body = JSON.parse(request.postData() ?? '{}');
    for (const resource of body.resourceSpans ?? [])
      for (const scope of resource.scopeSpans ?? [])
        spans.push(...(scope.spans ?? []));
  }
  if (/posthog\.com\/(e|i\/v0\/e|batch)\b/.test(target)) {
    posthog.push(...posthogEvents(request));
  }
});
page.on('response', (response) => {
  if (response.url().includes('/otel/'))
    relayStatus[response.status()] = (relayStatus[response.status()] ?? 0) + 1;
});

await page.goto(url);
await page.waitForSelector('#orders');
const layersText = (await page.textContent('#layers')) ?? '';
const on = (name) => new RegExp(`${name}: on`).test(layersText);
const layers = {
  rum: on('RUM'),
  posthog: on('PostHog'),
  errors: layersText.match(/Errors: (\w+)/)?.[1],
};
console.log(
  `layers: traces=datadog rum=${layers.rum} posthog=${layers.posthog} errors=${layers.errors}`,
);

await page.click('text=Checkout');
await page.click('#pay');
await page.waitForSelector('#checkout-error');
await page.click('text=Reports');
await page.waitForSelector('#report-error');
await page.click('text=Broken widget');
await page.waitForSelector('#route-error');
await page.click('text=Orders');
await page.click('#throw');
await page.click('#reject');
// posthog-js batches and flushes every ~3s; leaving sooner would hand the
// last batch to an unload beacon the test cannot read.
await sleep(layers.posthog ? 5000 : 2000);
const rumCookie = (await page.context().cookies()).find((c) =>
  c.name.startsWith('_dd_s'),
);
const rumSession = new URLSearchParams(
  decodeURIComponent(rumCookie?.value ?? ''),
).get('id');
// Leaving flushes every batch.
await page.goto('about:blank');
await sleep(3000);
await browser.close();

// autotel-web's OTLP/JSON carries ids as hex strings.
const hex = (id) => String(id);
const attr = (span, key) =>
  span.attributes?.find((a) => a.key === key)?.value?.stringValue;
const urlOf = (span) => attr(span, 'http.url') ?? attr(span, 'url.full') ?? '';
const exceptionOf = (span) =>
  span.events
    ?.find((e) => e.name === 'exception')
    ?.attributes?.find((a) => a.key === 'exception.message')?.value
    ?.stringValue;
const requestSpan = (path, method) =>
  spans.find(
    (s) =>
      urlOf(s).endsWith(path) &&
      (s.name.startsWith(method) || attr(s, 'http.method') === method),
  );

const expected = [
  ['the checkout 402', /status code 402/, '/api/checkout', 'POST'],
  ['the reports 500', /status code 500/, '/api/reports', 'GET'],
  ['the render crash', /reading 'reduce'/],
  ['the click-handler throw', /reading "royalties"/],
  ['the unhandled rejection', /Statement export timed out/],
];

// ---- Always: traces --------------------------------------------------------
check(
  diagnostics.length === 0,
  'no autotel diagnostics in the console',
  diagnostics.join(' | '),
);
check(
  Object.keys(relayStatus).every((code) => code.startsWith('2')),
  'the relay accepted every export',
  JSON.stringify(relayStatus),
);
check(
  !spans.some((s) =>
    /browser-intake-|rum-intake|ingest\.(\w+\.)?sentry\.io|i\.posthog\.com/.test(
      urlOf(s),
    ),
  ),
  'no span for a telemetry SDK’s own uploads',
);
const checkout = requestSpan('/api/checkout', 'POST');
check(Boolean(checkout), 'the checkout request was traced');

// ---- Sessions: each recorder's on the spans --------------------------------
const posthogSession = posthog.find((e) => e.properties?.$session_id)
  ?.properties.$session_id;
if (checkout && (layers.rum || layers.posthog)) {
  const owner = layers.errors === 'posthog' || !layers.rum ? 'posthog' : 'rum';
  const ids = { rum: rumSession, posthog: posthogSession };
  check(
    attr(checkout, 'session.id') === ids[owner],
    `spans carry the ${owner} session as session.id`,
    attr(checkout, 'session.id'),
  );
  if (layers.rum && layers.posthog) {
    const other = owner === 'rum' ? 'posthog' : 'datadog';
    const otherId = owner === 'rum' ? ids.posthog : ids.rum;
    check(
      attr(checkout, `${other}.session.id`) === otherId,
      `and the other recorder’s as ${other}.session.id`,
      attr(checkout, `${other}.session.id`),
    );
  }
}

// Logs and events (clicks, console output, vitals) are the same visit, so they
// carry the same session.id as the spans, whoever owns it.
if (checkout) {
  const spanSession = attr(checkout, 'session.id');
  check(
    logSessions.length > 0 && logSessions.every((id) => id === spanSession),
    'logs and events carry the spans’ session.id',
    `${logSessions.length} records, ${[...new Set(logSessions)].join(', ')} vs ${spanSession}`,
  );
}

// ---- Errors: exactly one owner ---------------------------------------------
const errorSpans = spans.filter(exceptionOf);
const onRequestTrace = (label, traceId, path, method) => {
  const request = requestSpan(path, method);
  check(
    Boolean(request) && traceId === hex(request.traceId),
    `${label} carries the trace of the request that failed`,
    `${traceId ?? '(none)'} vs ${request ? hex(request.traceId) : 'no request span'}`,
  );
};

if (layers.errors === 'autotel') {
  for (const [label, pattern, path, method] of expected) {
    const span = errorSpans.find((s) => pattern.test(exceptionOf(s)));
    check(
      Boolean(span),
      `${label} is an exception on a span`,
      exceptionOf(span ?? {}),
    );
    if (span && path) onRequestTrace(label, hex(span.traceId), path, method);
  }
} else {
  check(
    errorSpans.length === 0,
    'autotel records no second copy of the errors',
    errorSpans.map(exceptionOf).join(', '),
  );
}

let rumEvents;
if (layers.rum && process.env.VITE_DD_RUM_PROXY) {
  // Kept by the API's RUM proxy in development (not proxied by Vite).
  const api =
    process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 8082}`;
  rumEvents = await (await fetch(new URL('/rum-events', api))).json();
}
const rumErrors = (rumEvents ?? []).filter(
  (e) => e.type === 'error' && e.session?.id === rumSession,
);

if (layers.errors === 'rum' && rumEvents) {
  for (const [label, pattern, path, method] of expected) {
    const errors = rumErrors.filter((e) =>
      pattern.test(e.error?.message ?? ''),
    );
    check(
      errors.length === 1,
      `${label} is one RUM error`,
      errors.map((e) => e.error?.source).join(', '),
    );
    if (errors[0] && path)
      onRequestTrace(label, errors[0].context?.trace_id, path, method);
  }
} else if (layers.rum && rumEvents) {
  check(
    rumErrors.length === 0,
    'RUM sends no errors when another tool owns them',
    `${rumErrors.length}`,
  );
  const views = new Set(
    rumEvents.filter((e) => e.type === 'view').map((e) => e.view?.name),
  );
  check(
    views.has('/checkout') && views.has('/broken'),
    'RUM still records views by route',
    [...views].join(', '),
  );
}

const exceptions = posthog.filter((e) => e.event === '$exception');
const messageOf = (e) => e.properties?.$exception_list?.[0]?.value ?? '';
if (layers.errors === 'posthog') {
  for (const [label, pattern, path, method] of expected) {
    const events = exceptions.filter((e) => pattern.test(messageOf(e)));
    check(
      events.length === 1,
      `${label} is one PostHog $exception`,
      `${events.length}`,
    );
    if (events[0] && path) {
      onRequestTrace(label, events[0].properties.$trace_id, path, method);
      check(
        events[0].properties.$trace_url ===
          `https://app.${site}/apm/trace/${events[0].properties.$trace_id}`,
        `${label} links to the Datadog trace`,
        events[0].properties.$trace_url,
      );
    }
  }
} else if (layers.posthog) {
  check(
    exceptions.length === 0,
    'PostHog sends no $exception when another tool owns errors',
    `${exceptions.length}`,
  );
}

// ---- Datadog -----------------------------------------------------------------
if (!appKey || !apiKey) {
  console.log(
    'SKIP Datadog checks: set DD_APP_KEY (and DATADOG_API_KEY) to read back.',
  );
} else if (checkout) {
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

  const traceId = hex(checkout.traceId);
  let services = new Set();
  for (let attempt = 0; attempt < 10 && services.size < 2; attempt += 1) {
    await sleep(20_000);
    const result = await api('/api/v2/spans/events/search', {
      data: {
        type: 'search_request',
        attributes: {
          filter: { query: `trace_id:${traceId}`, from: 'now-1h', to: 'now' },
          page: { limit: 50 },
        },
      },
    });
    services = new Set((result.data ?? []).map((s) => s.attributes.service));
  }
  check(
    services.has('example-datadog-react-express-web') &&
      services.has('example-datadog-react-express-api'),
    'the checkout trace in Datadog holds the browser and the API',
    [...services].join(', '),
  );
  console.log(`checkout trace: https://app.${site}/apm/trace/${traceId}`);

  if (layers.errors === 'autotel') {
    let issues = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await api(
        '/api/v2/error-tracking/issues/search?include=issue',
        {
          data: {
            type: 'search_request',
            attributes: {
              query: 'service:example-datadog-react-express-web',
              from: startedAt - 86_400_000,
              to: Date.now(),
              track: 'trace',
            },
          },
        },
      );
      issues = (result.included ?? []).map(
        (i) => i.attributes.error_message ?? '',
      );
      if (expected.every(([, p]) => issues.some((i) => p.test(i)))) break;
      await sleep(30_000);
    }
    for (const [label, pattern] of expected)
      check(
        issues.some((i) => pattern.test(i)),
        `${label} is a Datadog Error Tracking issue`,
      );
  }
}

process.exit(failures.length ? 1 : 0);
