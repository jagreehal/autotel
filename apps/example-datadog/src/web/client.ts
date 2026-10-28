/// <reference lib="dom" />
import { trace } from '@opentelemetry/api';
import { datadogRum } from '@datadog/browser-rum';
import { initFull, span } from 'autotel-web/full';
import { joinDatadog } from 'autotel-datadog';

// Replaced at build time by src/web/server.ts (esbuild `define`).
declare const __DD_RUM__: {
  applicationId: string;
  clientToken: string;
  site: string;
  live: boolean;
};
declare const __RELEASE__: { version: string; environment: string };

const datadog = joinDatadog(datadogRum, {
  traceUrl: ({ traceId }) =>
    `https://app.${__DD_RUM__.site}/apm/trace/${traceId}`,
});

datadogRum.init({
  applicationId: __DD_RUM__.applicationId,
  clientToken: __DD_RUM__.clientToken,
  site: __DD_RUM__.site,
  service: 'example-datadog-web',
  env: __RELEASE__.environment,
  version: __RELEASE__.version,
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
  // Without a real RUM application, RUM posts to this server instead, which
  // keeps the events so the page (and smoke test) can show what RUM sent.
  proxy: __DD_RUM__.live ? undefined : '/rum-intake',
  // No allowedTracingUrls: autotel traces the requests.
  beforeSend: datadog.beforeSend,
});
datadogRum.setUser({ id: 'usr_example' });

initFull({
  service: 'example-datadog-web',
  version: __RELEASE__.version,
  environment: __RELEASE__.environment,
  // Same-origin: the server relays to Datadog with the API key added.
  endpoint: '/otel',
  // RUM's uploads through the local proxy are telemetry too: never traced,
  // never given baggage.
  ignoreUrls: __DD_RUM__.live ? [] : ['/rum-intake'],
  captureNavigation: false,
  captureWebVitals: false,
  captureLongTasks: false,
  spanEnrichers: [datadog],
});

const out = document.getElementById('out');
const show = (lines: string[]) => {
  if (out) out.textContent = lines.join('\n');
};

document.getElementById('checkout')?.addEventListener('click', () => {
  let traceId = '';
  void span('checkout.click', async () => {
    traceId = trace.getActiveSpan()?.spanContext().traceId ?? '';
    const response = await fetch('/checkout', { method: 'POST' });
    if (response.ok) return;
    // After an await: the browser has lost the active span. The RUM error
    // still gets this trace through joinDatadog's beforeSend.
    const error = new Error(`Checkout failed: ${response.status}`);
    datadogRum.addError(error);
    throw error;
  })
    .catch(() => {})
    .finally(() =>
      show([
        `trace_id: ${traceId}`,
        `rum session: ${datadogRum.getInternalContext()?.session_id ?? '(none)'}`,
        `rum: ${__DD_RUM__.live ? 'live' : 'local capture (set DD_RUM_* for live)'}`,
      ]),
    );
});

// Uncaught: RUM records it as a source error, and autotel-web's own error
// tracking puts it on a span that Datadog Error Tracking groups as an issue.
document.getElementById('throw')?.addEventListener('click', () => {
  throw new TypeError('Cannot read properties of undefined (reading "total")');
});
