import type { PluginPreset } from '../../types/index';

/**
 * PostHog browser preset — joins the trace to the session PostHog is recording.
 *
 * Distinct from the `posthog` subscriber preset, which posts events from a
 * server. A front end running `posthog-js` already has a session id, a person,
 * and often a replay; what it lacks is any link between those and its traces.
 * This wires both directions: spans carry the session, person and (on failures)
 * a replay link, and PostHog events carry the trace id that explains them.
 */
export const posthogWeb: PluginPreset = {
  name: 'PostHog (browser)',
  slug: 'posthog-web',
  type: 'plugin',
  description:
    'Join browser traces to PostHog sessions, replays and events (both directions)',
  packages: {
    required: ['autotel-web', 'autotel-posthog', 'posthog-js'],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  // Nothing is imported into the Node instrumentation file: this wiring belongs
  // in the browser entry, where `posthog` exists. An import here would load a
  // browser join into a server process that can never use it.
  imports: [],
  configBlock: {
    type: 'plugin',
    // A pointer, not code. The generated file is the server's; the enricher
    // goes wherever the app calls initFull(), which the CLI does not own.
    code: `// PostHog join: wire this in your browser entry, not here —
//   import posthog from 'posthog-js';
//   import { initFull } from 'autotel-web/full';
//   import { joinPostHog } from 'autotel-posthog';
//
//   posthog.init('<key>');
//   initFull({ service: '<app>', endpoint, spanEnrichers: [joinPostHog(posthog)] });`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Browser entry: initFull({ ..., spanEnrichers: [joinPostHog(posthog)] }) — one call wires both directions',
    'Docs: https://jagreehal.github.io/autotel/integrations/posthog/',
    'Backend init({ baggage: "" }) so the checkout span carries session.id from W3C baggage',
    'Spans now carry session.id and user.id from PostHog; failed spans carry session.replay.url',
    'For a clickable link back: joinPostHog(posthog, { traceUrl: ({ traceId }) => `...${traceId}` })',
    'Name any feature flags worth slicing by: joinPostHog(posthog, { featureFlags: ["my-flag"] })',
  ],
};
