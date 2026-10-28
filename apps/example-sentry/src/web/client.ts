import * as Sentry from '@sentry/browser';
import { initFull, span } from 'autotel-web/full';
import { joinSentry, sentryOtlpConfig } from 'autotel-sentry/browser';

// Replaced at build time by src/web/server.ts (esbuild `define`).
declare const __SENTRY_DSN__: string;
declare const __SENTRY_ORG__: string;

const sentry = sentryOtlpConfig(__SENTRY_DSN__);

// Sentry captures errors and records the replay. No browserTracingIntegration:
// autotel does the tracing, and two tracers would fight over traceparent.
Sentry.init({
  dsn: sentry.dsn,
  environment: 'example',
  integrations: [Sentry.replayIntegration()],
  replaysSessionSampleRate: 1,
});
Sentry.setUser({ id: 'usr_example' });

const last: Partial<Record<'traceId' | 'replayId' | 'replayUrl', string>> = {};

initFull({
  service: 'example-sentry-web',
  // Spans go straight to Sentry's OTLP endpoint, the key in the query string.
  endpoint: sentry.browserEndpoint,
  captureNavigation: false,
  captureWebVitals: false,
  captureLongTasks: false,
  spanEnrichers: [
    joinSentry(Sentry, {
      replayUrl: __SENTRY_ORG__
        ? (id) => `https://${__SENTRY_ORG__}.sentry.io/replays/${id}/`
        : undefined,
    }),
    // Only so the page can show what the span carried.
    {
      onStart() {},
      onEnd(s) {
        if (s.name !== 'checkout.click') return;
        last.traceId = s.spanContext().traceId;
        last.replayId = s.attributes['sentry.replay_id']?.toString();
        last.replayUrl = s.attributes['session.replay.url']?.toString();
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    },
  ],
});

const out = document.getElementById('out');

document.getElementById('checkout')?.addEventListener('click', () => {
  let eventId = '';
  void span('checkout.click', async () => {
    const response = await fetch('/checkout', { method: 'POST' });
    if (response.ok) return;
    // Plain capture, after an await: the browser has already lost the active
    // span here. joinSentry still puts the error on the right trace.
    const error = new Error(`Checkout failed: ${response.status}`);
    eventId = Sentry.captureException(error);
    throw error;
  })
    .catch(() => {})
    .finally(() => {
      if (!out) return;
      out.textContent = [
        `trace_id: ${last.traceId ?? '(missing)'}`,
        `sentry event: ${eventId || '(none)'}`,
        `sentry.replay_id: ${last.replayId ?? '(not recording)'}`,
        `session.replay.url: ${last.replayUrl ?? '(set SENTRY_ORG for a link)'}`,
      ].join('\n');
    });
});
