/**
 * Telemetry in layers. Each one is optional except the first, and each is
 * switched on by its own environment variables, so a page uses exactly the
 * tools it has:
 *
 * 1. Traces, always: autotel-web → /otel → the API's relay → Datadog APM.
 * 2. Datadog RUM, if VITE_DD_RUM_* is set: sessions, views by route, replay.
 *    `joinDatadog` puts the RUM session on spans and the trace on RUM errors.
 * 3. PostHog, if VITE_POSTHOG_KEY is set: product analytics and replay.
 *    `joinPostHog` puts the PostHog session on spans and the trace on events.
 *
 * Errors go to exactly one of them, VITE_ERRORS = autotel | rum | posthog.
 * The default is the richest tool present: PostHog, else RUM, else autotel's
 * own spans (which Datadog Error Tracking groups as issues). Whichever owns
 * errors, the others stay quiet about them, so one error is one issue.
 */
import { datadogRum } from '@datadog/browser-rum';
import { addReactError, reactPlugin } from '@datadog/browser-rum-react';
import posthog from 'posthog-js';
import type { ErrorInfo } from 'react';
import { joinDatadog, type DatadogJoin } from 'autotel-datadog';
import { joinPostHog, traceProperties } from 'autotel-posthog';
import {
  captureException,
  initFull,
  type AutotelWebFullConfig,
} from 'autotel-web/full';

type SpanEnricher = NonNullable<AutotelWebFullConfig['spanEnrichers']>[number];

const env = import.meta.env;
const service = 'example-datadog-react-express-web';
const version = env.VITE_APP_VERSION ?? '1.0.0';
const environment = env.VITE_APP_ENV ?? 'local';
const site = env.VITE_DD_SITE ?? 'datadoghq.com';
const traceUrl = ({ traceId }: { traceId: string }) =>
  `https://app.${site}/apm/trace/${traceId}`;

export const layers = {
  rum: Boolean(env.VITE_DD_RUM_APPLICATION_ID && env.VITE_DD_RUM_CLIENT_TOKEN),
  posthog: Boolean(env.VITE_POSTHOG_KEY),
};

const ERROR_TRACKERS = ['autotel', 'rum', 'posthog'] as const;
type ErrorTracker = (typeof ERROR_TRACKERS)[number];
const requested = ERROR_TRACKERS.find((name) => name === env.VITE_ERRORS);
export const errors: ErrorTracker =
  requested && (requested === 'autotel' || layers[requested])
    ? requested
    : layers.posthog
      ? 'posthog'
      : layers.rum
        ? 'rum'
        : 'autotel';

/** The joins, error owner first: the first join created owns `session.id`. */
const joins: Array<[ErrorTracker, () => SpanEnricher]> = [];

// ---- Layer 2: Datadog RUM ---------------------------------------------------
// Created below, in the error owner's order; RUM only calls beforeSend later.
let datadog: DatadogJoin | undefined;
if (layers.rum) {
  datadogRum.init({
    applicationId: env.VITE_DD_RUM_APPLICATION_ID!,
    clientToken: env.VITE_DD_RUM_CLIENT_TOKEN!,
    site,
    service,
    env: environment,
    version,
    // Replay rate, privacy and the rest, managed from Datadog without a deploy.
    ...(env.VITE_DD_RUM_REMOTE_CONFIG_ID && {
      remoteConfiguration: { id: env.VITE_DD_RUM_REMOTE_CONFIG_ID },
    }),
    // Through your own origin: survives ad blockers. Here it is also how the
    // smoke test reads what RUM sent without a RUM application.
    ...(env.VITE_DD_RUM_PROXY && { proxy: env.VITE_DD_RUM_PROXY }),
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    defaultPrivacyLevel: 'mask-user-input',
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    // One RUM view per route, named by its pattern (/orders/:id), not its URL.
    plugins: [reactPlugin({ router: true })],
    // No allowedTracingUrls: autotel traces the requests.
    beforeSend: (event, context) =>
      (datadog?.beforeSend(event, context) ?? true) &&
      // RUM collects errors whatever you ask; when another tool owns them,
      // drop them here, as Datadog documents, so each error is one issue.
      (event.type !== 'error' || errors === 'rum') &&
      !isRouterRenderLog(event),
  });
  joins.push(['rum', () => (datadog = joinDatadog(datadogRum, { traceUrl }))]);
}

// ---- Layer 3: PostHog -------------------------------------------------------
if (layers.posthog) {
  posthog.init(env.VITE_POSTHOG_KEY!, {
    api_host: env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    person_profiles: 'always',
    // Exception autocapture only when PostHog owns errors.
    capture_exceptions: errors === 'posthog',
    // posthog-js drops headless browsers as bots; the smoke test is one.
    opt_out_useragent_filter: env.VITE_POSTHOG_ALLOW_BOTS === 'true',
  });
  // `traceUrl` links every PostHog event, `$exception`s included, to the
  // Datadog trace.
  joins.push(['posthog', () => joinPostHog(posthog, { traceUrl })]);
}

// ---- Layer 1: traces, always ------------------------------------------------
// The error owner's join is created first, so its session is the `session.id`
// on spans and in baggage; any other recorder's is `<name>.session.id`.
joins.sort(([a], [b]) => Number(b === errors) - Number(a === errors));
const spanEnrichers = joins.map(([, create]) => create());

initFull({
  service,
  version,
  environment,
  // Same origin: the API relays to Datadog with the key added on the server.
  endpoint: '/otel',
  // autotel records uncaught errors only when it is the error tracker.
  captureErrors: errors === 'autotel',
  captureConsoleLogs: true,
  // RUM's uploads through the proxy are telemetry too.
  ignoreUrls: env.VITE_DD_RUM_PROXY ? [env.VITE_DD_RUM_PROXY] : [],
  spanEnrichers,
});

/**
 * In development react-router also console.errors a render error its boundary
 * caught. `addReactError` already reported it, with the component stack, so
 * RUM's console copy would make the same crash two errors.
 */
function isRouterRenderLog(event: {
  type: string;
  error?: { source?: string; message?: string };
}): boolean {
  return (
    event.type === 'error' &&
    event.error?.source === 'console' &&
    (event.error.message ?? '').startsWith(
      'React Router caught the following error',
    )
  );
}

/**
 * Errors the app handles itself (failed queries), sent to whichever tool owns
 * errors. A handled error reaches no global handler, so it has to be passed on.
 */
/** Where in the app a handled error came from, sent with it. */
interface ErrorOrigin {
  query?: string;
  mutation?: string;
  componentStack?: string | null;
}

export function reportError(error: unknown, context?: ErrorOrigin) {
  if (errors === 'rum') datadogRum.addError(error, context);
  // PostHog's before_send never sees the error object, so the request's
  // trace is passed explicitly.
  else if (errors === 'posthog') {
    posthog.captureException(error, { ...context, ...traceProperties(error) });
  } else captureException(error);
}

/**
 * React's own error reports (`createRoot`'s onCaughtError and
 * onUncaughtError). RUM's `addReactError` keeps the component stack.
 */
export function reportReactError(error: unknown, info: ErrorInfo) {
  if (errors === 'rum') addReactError(error, info);
  else reportError(error, { componentStack: info.componentStack });
}

export function identify(user: { id: string; name: string }) {
  if (layers.rum) datadogRum.setUser(user);
  if (layers.posthog) posthog.identify(user.id, { name: user.name });
}
