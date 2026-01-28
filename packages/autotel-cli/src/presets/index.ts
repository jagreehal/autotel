import type {
  BackendPreset,
  SubscriberPreset,
  PluginPreset,
  PlatformPreset,
  QuickPreset,
  PresetRegistry,
  Preset,
  PresetType,
} from '../types/index';

// Import all presets
import { datadogDirect, datadogAgent } from './backends/datadog';
import { honeycomb } from './backends/honeycomb';
import { otlpHttp, otlpGrpc, local } from './backends/otlp';
import { posthog } from './subscribers/posthog';
import { mixpanel, amplitude, segment, slack, webhook } from './subscribers/mixpanel';
import { mongoose, drizzle } from './plugins/mongoose';
import { awsLambda, cloudflare, edge } from './platforms/aws';

/**
 * Backend presets registry
 */
export const backends = new Map<string, BackendPreset>([
  ['datadog', datadogDirect],
  ['datadog-agent', datadogAgent],
  ['honeycomb', honeycomb],
  ['otlp-http', otlpHttp],
  ['otlp-grpc', otlpGrpc],
  ['local', local],
]);

/**
 * Subscriber presets registry
 */
export const subscribers = new Map<string, SubscriberPreset>([
  ['posthog', posthog],
  ['mixpanel', mixpanel],
  ['amplitude', amplitude],
  ['segment', segment],
  ['slack', slack],
  ['webhook', webhook],
]);

/**
 * Plugin presets registry
 */
export const plugins = new Map<string, PluginPreset>([
  ['mongoose', mongoose],
  ['drizzle', drizzle],
]);

/**
 * Platform presets registry
 */
export const platforms = new Map<string, PlatformPreset>([
  ['aws-lambda', awsLambda],
  ['cloudflare', cloudflare],
  ['edge', edge],
]);

/**
 * Quick presets (named bundles)
 */
export const quickPresets = new Map<string, QuickPreset>([
  [
    'node-datadog-pino',
    {
      name: 'Node.js + Datadog + Pino',
      slug: 'node-datadog-pino',
      description: 'Standard Node.js setup with Datadog and Pino logging',
      backend: 'datadog',
      logging: 'pino',
      autoInstrumentations: 'all',
    },
  ],
  [
    'node-datadog-agent',
    {
      name: 'Node.js + Datadog Agent',
      slug: 'node-datadog-agent',
      description: 'Node.js with Datadog Agent for local development',
      backend: 'datadog-agent',
      logging: 'pino',
      autoInstrumentations: 'all',
    },
  ],
  [
    'node-honeycomb',
    {
      name: 'Node.js + Honeycomb',
      slug: 'node-honeycomb',
      description: 'Standard Node.js setup with Honeycomb',
      backend: 'honeycomb',
      autoInstrumentations: 'all',
    },
  ],
  [
    'node-otlp',
    {
      name: 'Node.js + Generic OTLP',
      slug: 'node-otlp',
      description: 'Node.js with generic OTLP endpoint',
      backend: 'otlp-http',
      autoInstrumentations: 'all',
    },
  ],
]);

/**
 * Full preset registry
 */
export const presetRegistry: PresetRegistry = {
  backends,
  subscribers,
  plugins,
  platforms,
  quick: quickPresets,
};

/**
 * Get preset by type and slug
 */
export function getPreset(type: PresetType, slug: string): Preset | undefined {
  switch (type) {
    case 'backend':
      return backends.get(slug);
    case 'subscriber':
      return subscribers.get(slug);
    case 'plugin':
      return plugins.get(slug);
    case 'platform':
      return platforms.get(slug);
  }
}

/**
 * Get all presets of a type
 */
export function getPresetsByType(type: PresetType): Map<string, Preset> {
  switch (type) {
    case 'backend':
      return backends as Map<string, Preset>;
    case 'subscriber':
      return subscribers as Map<string, Preset>;
    case 'plugin':
      return plugins as Map<string, Preset>;
    case 'platform':
      return platforms as Map<string, Preset>;
  }
}

/**
 * Get quick preset by slug
 */
export function getQuickPreset(slug: string): QuickPreset | undefined {
  return quickPresets.get(slug);
}

/**
 * List all preset slugs by type
 */
export function listPresetSlugs(type: PresetType): string[] {
  return [...getPresetsByType(type).keys()];
}

/**
 * Check if a preset exists
 */
export function presetExists(type: PresetType, slug: string): boolean {
  return getPresetsByType(type).has(slug);
}

/**
 * Re-export individual presets for direct access
 */
export {
  datadogDirect,
  datadogAgent,
  honeycomb,
  otlpHttp,
  otlpGrpc,
  local,
  posthog,
  mixpanel,
  amplitude,
  segment,
  slack,
  webhook,
  mongoose,
  drizzle,
  awsLambda,
  cloudflare,
  edge,
};
