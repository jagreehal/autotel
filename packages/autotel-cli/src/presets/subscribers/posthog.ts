import type { SubscriberPreset } from '../../types/index';

/**
 * PostHog subscriber preset — product events posted from the server.
 *
 * The browser counterpart is the `posthog-web` plugin preset, which joins
 * traces to the session PostHog is recording. Both live in `autotel-posthog`;
 * this one needs `autotel-subscribers` too, for the base class it extends.
 */
export const posthog: SubscriberPreset = {
  name: 'PostHog',
  slug: 'posthog',
  type: 'subscriber',
  description: 'Send events to PostHog for product analytics',
  packages: {
    required: ['autotel-posthog', 'autotel-subscribers', 'posthog-node'],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'POSTHOG_API_KEY',
        description: 'PostHog Project API Key',
        example: 'phc_...',
        sensitive: true,
      },
    ],
    optional: [
      {
        name: 'POSTHOG_HOST',
        description: 'PostHog host URL (for self-hosted)',
        example: 'https://app.posthog.com',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-posthog/subscriber',
      specifiers: ['PostHogSubscriber'],
    },
  ],
  configBlock: {
    type: 'subscriber',
    code: `new PostHogSubscriber({
      apiKey: process.env.POSTHOG_API_KEY,
      host: process.env.POSTHOG_HOST,
    }),`,
    section: 'SUBSCRIBERS_CONFIG',
  },
  nextSteps: [
    'Set POSTHOG_API_KEY from PostHog Project Settings',
    'Events will be sent to PostHog as custom events',
  ],
};

// Alias for test compatibility
export { posthog as posthogSubscriber };
