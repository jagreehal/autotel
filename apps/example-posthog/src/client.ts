import { initFull, span } from 'autotel-web/full';
import { joinPostHog, type PostHogLike } from 'autotel-posthog';
import posthogJs from 'posthog-js';

// Replaced at build time by src/server.ts (esbuild `define`).
declare const __POSTHOG_KEY__: string;
declare const __POSTHOG_HOST__: string;

type Capture = {
  uuid: string;
  event: string;
  properties: Record<string, unknown>;
};

/** The read surface autotel uses, plus the one write the demo makes. */
type ExamplePostHog = PostHogLike & {
  capture: (event: string, properties?: Capture['properties']) => unknown;
};

/** Lets the page run with no project key. */
function stubPosthog(): ExamplePostHog {
  const instance: ExamplePostHog = {
    config: { before_send: [] },
    set_config(patch) {
      Object.assign(instance.config ?? {}, patch);
    },
    get_session_id: () => '0195f1c2-example-session',
    get_distinct_id: () => 'usr_example',
    get_session_replay_url: () =>
      'https://us.posthog.com/replay/0195f1c2-example-session?t=0',
    sessionRecordingStarted: () => true,
    capture(event, properties = {}) {
      let payload: Capture | null = {
        uuid: 'e1',
        event,
        properties: { ...properties },
      };
      const hooks = instance.config?.before_send;
      const chain = Array.isArray(hooks) ? hooks : hooks ? [hooks] : [];
      for (const hook of chain) {
        if (typeof hook !== 'function') continue;
        payload = hook(payload) as Capture | null;
        if (payload === null) return;
      }
    },
  };
  return instance;
}

const live = Boolean(__POSTHOG_KEY__);

const posthog: ExamplePostHog = live
  ? (posthogJs.init(__POSTHOG_KEY__, {
      api_host: __POSTHOG_HOST__,
      // The join reads the session id on every span, so it has to exist before
      // the first one. Without a person profile PostHog still keeps a session.
      person_profiles: 'always',
      autocapture: false,
      capture_pageview: true,
    }),
    posthogJs)
  : stubPosthog();

// What the loader snippet leaves on the page, and where autotel looks when it
// is not handed an instance. Useful in the console, too.
globalThis.posthog = posthog;

const lastSpan: { replayUrl?: string; sessionId?: string } = {};

initFull({
  service: 'example-posthog',
  captureNavigation: false,
  captureWebVitals: false,
  captureLongTasks: false,
  captureErrors: false,
  spanProcessor: {
    onStart() {},
    onEnd(s) {
      const url = s.attributes['session.replay.url'];
      if (typeof url === 'string') lastSpan.replayUrl = url;
      const sessionId = s.attributes['session.id'];
      if (typeof sessionId === 'string') lastSpan.sessionId = sessionId;
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  },
  spanEnrichers: [
    joinPostHog(posthog, {
      traceUrl: ({ traceId }) => `https://traces.example.com/${traceId}`,
      // `debug` is not set: it defaults on in development, so a join that
      // cannot do its job says why in the console instead of quietly
      // producing nothing.
    }),
  ],
});

// Appended *after* joinPostHog, so it sees what autotel stamped on the event.
const captured: Capture[] = [];
const chain = posthog.config?.before_send;
posthog.set_config?.({
  before_send: [
    ...(Array.isArray(chain) ? chain : chain ? [chain] : []),
    (event: Capture | null) => {
      if (event) captured.push(event);
      return event;
    },
  ],
} as Parameters<NonNullable<PostHogLike['set_config']>>[0]);

const out = document.getElementById('out');
const button = document.getElementById('checkout');

function write(text: string): void {
  if (out) out.textContent = text;
}

button?.addEventListener('click', () => {
  void span('checkout.click', async () => {
    captured.length = 0;
    try {
      await fetch('/checkout', { method: 'POST' });
    } catch {
      // Network errors still leave a failed span.
    }
    // Plain capture, after an await: the browser has no AsyncLocalStorage, so
    // the active span is already gone here. joinPostHog still finds it.
    posthog.capture('checkout_failed', { message: 'Card declined' });
    throw new Error('Card declined');
  }).catch(() => {
    const event = captured.find((e) => e.event === 'checkout_failed');
    write(
      [
        `posthog: ${live ? 'live' : 'stub'}`,
        `session.id: ${lastSpan.sessionId ?? '(missing)'}`,
        `session.replay.url: ${lastSpan.replayUrl ?? '(missing)'}`,
        `$trace_id: ${String(event?.properties['$trace_id'] ?? '(missing)')}`,
        `$span_id: ${String(event?.properties['$span_id'] ?? '(missing)')}`,
        `$trace_url: ${String(event?.properties['$trace_url'] ?? '(missing)')}`,
        '',
        'Check the server terminal for session.id on POST /checkout.',
      ].join('\n'),
    );
  });
});
