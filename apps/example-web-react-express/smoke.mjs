/**
 * Drives the SPA in headless Chromium against the API in each configuration a
 * team meets when turning autotel-web on, and checks what reaches the server.
 *
 *   pnpm --filter autotel-web --filter autotel-posthog --filter autotel build && node smoke.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const failures = [];
const check = (ok, description, detail = '') => {
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${description}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures.push(description);
};

function start(cmd, args, env, ready) {
  const child = spawn(cmd, args, {
    cwd: dir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', (c) => (child.log += c));
  child.stderr.on('data', (c) => (child.log += c));
  return (async () => {
    for (let i = 0; i < 60; i++) {
      if (child.log.includes(ready)) return child;
      if (child.exitCode !== null)
        throw new Error(`${cmd} exited:\n${child.log}`);
      await sleep(250);
    }
    child.kill();
    throw new Error(`${cmd} never ready:\n${child.log}`);
  })();
}

async function scenario(name, { apiEnv = {}, webEnv = {} }) {
  console.log(`\n# ${name}`);
  let api, web, browser;
  try {
    api = await start(
      'node',
      ['--require', './server/telemetry.cjs', 'server/index.cjs'],
      apiEnv,
      'API listening',
    );
    web = await start(
      'node_modules/.bin/vite',
      ['--port', '5173', '--strictPort'],
      webEnv,
      'Local:',
    );
    browser = await chromium.launch();
    const page = await browser.newPage();
    const sent = [];
    const pageErrors = [];
    const otlp = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('request', (r) => {
      if (r.url().endsWith('/v1/traces')) otlp.push(r.postData() ?? '');
      if (
        r.url().startsWith('http://localhost:8081') &&
        r.method() !== 'OPTIONS'
      ) {
        sent.push({ url: r.url(), traceparent: r.headers().traceparent });
      }
    });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    const outputs = [];
    for (const [i, id] of ['get', 'post', 'fetch'].entries()) {
      await page.click(`#${id}`);
      await page.waitForFunction(
        (n) => document.querySelector('#out').dataset.done === String(n),
        i + 1,
      );
      outputs.push(await page.textContent('#out'));
    }
    await sleep(2500); // the lean exporter flushes every 2s
    const phSession = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('ph_phc_example_posthog') ?? '{}')
          .$sesid?.[1],
    );
    const serverSpans = [...api.log.matchAll(/^server-span (.+)$/gm)]
      .map((m) => JSON.parse(m[1]))
      .filter((span) => span.kind === 1); // SERVER
    return { sent, outputs, serverSpans, pageErrors, otlp, phSession };
  } finally {
    await browser?.close();
    api?.kill();
    web?.kill();
    await sleep(500);
  }
}

// OTLP/JSON attribute list → plain object.
const attrs = (list = []) =>
  Object.fromEntries(
    list.map(({ key, value }) => [
      key,
      // OTLP/JSON carries 64-bit ints as strings.
      'intValue' in value ? Number(value.intValue) : Object.values(value)[0],
    ]),
  );

/**
 * The acceptance test: full mode with default capture, one slow interaction
 * and one backend failure. Returns what reached the collector and the API.
 */
async function acceptance() {
  console.log('\n# full mode: slow interaction + backend failure');
  let api, web, browser;
  try {
    api = await start(
      'node',
      ['--require', './server/telemetry.cjs', 'server/index.cjs'],
      {},
      'API listening',
    );
    web = await start(
      'node_modules/.bin/vite',
      ['--port', '5173', '--strictPort'],
      {},
      'Local:',
    );
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    // Stand-in collector: keeps every OTLP payload, beacons included.
    const payloads = { traces: [], logs: [] };
    await page.route('http://localhost:4318/**', (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const signal = new URL(req.url()).pathname.split('/').pop();
        payloads[signal]?.push(JSON.parse(req.postData() ?? '{}'));
      }
      return route.fulfill({
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
        },
        body: '{}',
      });
    });
    await page.goto('http://localhost:5173/full.html', {
      waitUntil: 'networkidle',
    });
    await page.click('#checkout');
    await page.waitForFunction(
      () => document.querySelector('#out').textContent === 'cart rendered',
    );
    await page.click('#pay');
    await page.waitForFunction(() =>
      document.querySelector('#out').textContent.startsWith('pay '),
    );
    // The user leaves: INP is final once the page is hidden.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(3000);
    const events = payloads.logs.flatMap((p) =>
      (p.resourceLogs ?? []).flatMap((r) =>
        r.scopeLogs.flatMap((s) =>
          s.logRecords.map((l) => ({
            name: l.eventName,
            ...attrs(l.attributes),
          })),
        ),
      ),
    );
    const spans = payloads.traces.flatMap((p) =>
      (p.resourceSpans ?? []).flatMap((r) =>
        r.scopeSpans.flatMap((s) =>
          s.spans.map((sp) => ({ ...sp, attributes: attrs(sp.attributes) })),
        ),
      ),
    );
    const serverSpans = [...api.log.matchAll(/^server-span (.+)$/gm)].map((m) =>
      JSON.parse(m[1]),
    );
    return { events, spans, serverSpans, pageErrors };
  } finally {
    await browser?.close();
    api?.kill();
    web?.kill();
    await sleep(500);
  }
}

const apiOrigin = { VITE_PROPAGATE_TO: 'localhost:8081' };
const ok = (r) => r.outputs.every((o) => !o.startsWith('error'));

try {
  // 1. Drop-in: init() with no propagateTo. Cross-origin API gets nothing new.
  let r = await scenario('default init, API CORS unchanged', {
    apiEnv: { CORS_ALLOW_TRACEPARENT: 'false' },
  });
  check(r.pageErrors.length === 0, 'no page errors', r.pageErrors.join('; '));
  check(ok(r), 'axios GET/POST and fetch succeed', r.outputs.join(' | '));
  check(
    r.sent.every((s) => !s.traceparent),
    'no traceparent sent cross-origin by default',
  );

  // 2. propagateTo set but the API preflight does not allow the header.
  r = await scenario('propagateTo set, API CORS unchanged', {
    apiEnv: { CORS_ALLOW_TRACEPARENT: 'false' },
    webEnv: apiOrigin,
  });
  check(
    !ok(r),
    'requests are blocked by CORS (API must allow traceparent)',
    r.outputs.join(' | '),
  );

  // 3. propagateTo + API allows traceparent: browser and server share a trace.
  r = await scenario('propagateTo set, API allows traceparent', {
    webEnv: apiOrigin,
  });
  check(ok(r), 'axios GET/POST and fetch succeed', r.outputs.join(' | '));
  check(
    r.sent.length === 3 &&
      r.sent.every((s) =>
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(s.traceparent ?? ''),
      ),
    'traceparent on XHR and fetch',
  );
  for (const s of r.sent) {
    const [, traceId, spanId] = s.traceparent.split('-');
    const server = r.serverSpans.find((x) => x.traceId === traceId);
    check(
      server?.parentSpanId === spanId,
      `server span joins browser trace (${new URL(s.url).pathname})`,
      server?.name,
    );
  }

  // 4. API head-samples 1% parent-based; the browser marks every request sampled.
  const sampling = {
    OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
    OTEL_TRACES_SAMPLER_ARG: '0.01',
  };
  r = await scenario('API samples 1% parent-based, browser default', {
    apiEnv: sampling,
    webEnv: apiOrigin,
  });
  check(
    r.serverSpans.length === 3,
    'browser-sampled requests are all kept (sampled flag honoured)',
    `${r.serverSpans.length}/3`,
  );

  // 5. Browser sampleRate drops the session; flag cleared, server drops it too.
  r = await scenario('API samples 1% parent-based, browser sampleRate 0', {
    apiEnv: sampling,
    webEnv: { ...apiOrigin, VITE_SAMPLE_RATE: '0' },
  });
  check(ok(r), 'requests still succeed', r.outputs.join(' | '));
  check(
    r.sent.every((s) => s.traceparent?.endsWith('-00')),
    'traceparent sent with sampled flag cleared',
    r.sent.map((s) => s.traceparent).join(' '),
  );
  check(
    r.serverSpans.length === 0,
    'server drops the unsampled session',
    `${r.serverSpans.length} kept`,
  );

  // 6. posthog-js initialised the way an app does it (module import, in an effect).
  r = await scenario('PostHog session id on browser spans', {
    webEnv: {
      ...apiOrigin,
      VITE_POSTHOG_KEY: 'phc_example',
      VITE_POSTHOG_HOST: 'http://localhost:9',
      VITE_OTLP_ENDPOINT: 'http://localhost:5173',
    },
  });
  check(
    ok(r),
    'requests still succeed with PostHog on the page',
    r.outputs.join(' | '),
  );
  const spanSessions = r.otlp.flatMap((b) =>
    [...b.matchAll(/"session.id","value":{"stringValue":"([^"]+)"/g)].map(
      (m) => m[1],
    ),
  );
  check(
    Boolean(r.phSession) && spanSessions.includes(r.phSession),
    'browser span carries the PostHog session.id',
    `${r.phSession} in [${spanSessions}]`,
  );

  // 7. Acceptance: someone who has never seen the SDK finds both causes.
  const a = await acceptance();
  check(a.pageErrors.length === 0, 'no page errors', a.pageErrors.join('; '));

  // Slow interaction: filter browser.web_vital to poor INP, read the culprit.
  const inp = a.events.find(
    (e) =>
      e.name === 'browser.web_vital' && e['browser.web_vital.name'] === 'inp',
  );
  check(
    inp?.['browser.web_vital.rating'] === 'poor',
    'slow click reported as poor INP',
    `${inp?.['browser.web_vital.value']}ms`,
  );
  check(
    inp?.['browser.web_vital.target'] === '#checkout',
    'INP names the element',
    inp?.['browser.web_vital.target'],
  );
  check(
    inp?.['browser.web_vital.longest_script.function'] === 'renderCart' &&
      inp?.['browser.web_vital.longest_script.subpart'] ===
        'processing-duration',
    'INP names the handler and the phase it blocked',
    `${inp?.['browser.web_vital.longest_script.function']} in ${inp?.['browser.web_vital.longest_script.subpart']} (${inp?.['browser.web_vital.longest_script.invoker']})`,
  );
  check(
    typeof inp?.['browser.web_vital.navigation_id'] === 'number',
    'INP carries its navigation id',
  );

  // Backend failure: failed browser span → its trace → the server's error.
  const failed = a.spans.find(
    (sp) => sp.attributes['http.response.status_code'] === 500,
  );
  check(Boolean(failed), 'browser fetch span records the 500', failed?.name);
  const trace = a.serverSpans.filter((sp) => sp.traceId === failed?.traceId);
  const server = trace.find((sp) => sp.kind === 1);
  check(
    server?.parentSpanId === failed?.spanId,
    "server span is the browser span's child",
    server?.name,
  );
  check(
    server?.status === 2 && server.httpStatus === 500,
    'server span marked as error',
    JSON.stringify(server),
  );
  check(
    trace.some((sp) => sp.exceptions.includes('card processor timeout')),
    'server trace carries the exception message',
    JSON.stringify(trace.map((sp) => [sp.name, sp.exceptions])),
  );
} finally {
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
  process.exitCode = failures.length ? 1 : 0;
}
