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
    const serverSpans = [...api.log.matchAll(/^server-span (.+)$/gm)].map((m) =>
      JSON.parse(m[1]),
    );
    return { sent, outputs, serverSpans, pageErrors, otlp, phSession };
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
} finally {
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
  process.exitCode = failures.length ? 1 : 0;
}
