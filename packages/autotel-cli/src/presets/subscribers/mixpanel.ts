import type { SubscriberPreset } from '../../types/index.js';

/**
 * Mixpanel subscriber preset
 */
export const mixpanel: SubscriberPreset = {
  name: 'Mixpanel',
  slug: 'mixpanel',
  type: 'subscriber',
  description: 'Send events to Mixpanel for product analytics',
  packages: {
    required: [
      'autotel-subscribers',
      'mixpanel',
    ],
    optional: [],
    devOnly: [
      '@types/mixpanel',
    ],
  },
  env: {
    required: [
      {
        name: 'MIXPANEL_TOKEN',
        description: 'Mixpanel Project Token',
        example: 'your-project-token',
        sensitive: true,
      },
    ],
    optional: [
      {
        name: 'MIXPANEL_API_HOST',
        description: 'Mixpanel API host (for EU data residency)',
        example: 'api-eu.mixpanel.com',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-subscribers/mixpanel',
      specifiers: ['MixpanelSubscriber'],
    },
  ],
  configBlock: {
    type: 'subscriber',
    code: `new MixpanelSubscriber({
      token: process.env.MIXPANEL_TOKEN,
    }),`,
    section: 'SUBSCRIBERS_CONFIG',
  },
  nextSteps: [
    'Set MIXPANEL_TOKEN from Mixpanel Project Settings',
    'Events will be tracked as Mixpanel events',
  ],
};

/**
 * Amplitude subscriber preset
 */
export const amplitude: SubscriberPreset = {
  name: 'Amplitude',
  slug: 'amplitude',
  type: 'subscriber',
  description: 'Send events to Amplitude for product analytics',
  packages: {
    required: [
      'autotel-subscribers',
      '@amplitude/analytics-node',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'AMPLITUDE_API_KEY',
        description: 'Amplitude API Key',
        example: 'your-api-key',
        sensitive: true,
      },
    ],
    optional: [
      {
        name: 'AMPLITUDE_SERVER_URL',
        description: 'Amplitude server URL (for EU data center)',
        example: 'https://api.eu.amplitude.com/2/httpapi',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-subscribers/amplitude',
      specifiers: ['AmplitudeSubscriber'],
    },
  ],
  configBlock: {
    type: 'subscriber',
    code: `new AmplitudeSubscriber({
      apiKey: process.env.AMPLITUDE_API_KEY,
    }),`,
    section: 'SUBSCRIBERS_CONFIG',
  },
  nextSteps: [
    'Set AMPLITUDE_API_KEY from Amplitude Project Settings',
    'Events will be sent to Amplitude',
  ],
};

/**
 * Segment subscriber preset
 */
export const segment: SubscriberPreset = {
  name: 'Segment',
  slug: 'segment',
  type: 'subscriber',
  description: 'Send events to Segment for routing to destinations',
  packages: {
    required: [
      'autotel-subscribers',
      '@segment/analytics-node',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'SEGMENT_WRITE_KEY',
        description: 'Segment Source Write Key',
        example: 'your-write-key',
        sensitive: true,
      },
    ],
    optional: [],
  },
  imports: [
    {
      source: 'autotel-subscribers/segment',
      specifiers: ['SegmentSubscriber'],
    },
  ],
  configBlock: {
    type: 'subscriber',
    code: `new SegmentSubscriber({
      writeKey: process.env.SEGMENT_WRITE_KEY,
    }),`,
    section: 'SUBSCRIBERS_CONFIG',
  },
  nextSteps: [
    'Set SEGMENT_WRITE_KEY from your Segment Source settings',
    'Configure destinations in Segment to route events',
  ],
};

/**
 * Slack subscriber preset
 */
export const slack: SubscriberPreset = {
  name: 'Slack',
  slug: 'slack',
  type: 'subscriber',
  description: 'Send event notifications to Slack',
  packages: {
    required: [
      'autotel-subscribers',
      '@slack/web-api',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'SLACK_WEBHOOK_URL',
        description: 'Slack Incoming Webhook URL',
        example: 'https://hooks.slack.com/services/...',
        sensitive: true,
      },
    ],
    optional: [
      {
        name: 'SLACK_CHANNEL',
        description: 'Default channel for notifications',
        example: '#alerts',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-subscribers/slack',
      specifiers: ['SlackSubscriber'],
    },
  ],
  configBlock: {
    type: 'subscriber',
    code: `new SlackSubscriber({
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: process.env.SLACK_CHANNEL,
    }),`,
    section: 'SUBSCRIBERS_CONFIG',
  },
  nextSteps: [
    'Create an Incoming Webhook in your Slack workspace',
    'Set SLACK_WEBHOOK_URL with the webhook URL',
  ],
};

/**
 * Generic Webhook subscriber preset
 */
export const webhook: SubscriberPreset = {
  name: 'Webhook',
  slug: 'webhook',
  type: 'subscriber',
  description: 'Send events to a custom webhook endpoint',
  packages: {
    required: [
      'autotel-subscribers',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'WEBHOOK_URL',
        description: 'Webhook endpoint URL',
        example: 'https://api.example.com/events',
        sensitive: false,
      },
    ],
    optional: [
      {
        name: 'WEBHOOK_SECRET',
        description: 'Shared secret for webhook signatures',
        example: 'your-secret',
        sensitive: true,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-subscribers/webhook',
      specifiers: ['WebhookSubscriber'],
    },
  ],
  configBlock: {
    type: 'subscriber',
    code: `new WebhookSubscriber({
      url: process.env.WEBHOOK_URL,
      secret: process.env.WEBHOOK_SECRET,
    }),`,
    section: 'SUBSCRIBERS_CONFIG',
  },
  nextSteps: [
    'Set WEBHOOK_URL to your endpoint',
    'Implement the webhook receiver to handle incoming events',
  ],
};
