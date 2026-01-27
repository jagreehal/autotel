/**
 * Environment variable definition for presets
 */
export interface EnvVar {
  name: string;
  description: string;
  example?: string;
  sensitive: boolean;
}

/**
 * Import statement for code generation
 */
export interface Import {
  source: string;
  specifiers?: string[];
  default?: string;
  sideEffect?: boolean;
}

/**
 * Configuration block for init() call
 */
export interface ConfigBlock {
  type: 'backend' | 'subscriber' | 'plugin' | 'platform';
  code: string;
  section: 'BACKEND_CONFIG' | 'SUBSCRIBERS_CONFIG' | 'PLUGIN_INIT';
}

/**
 * Package requirements for a preset
 */
export interface PackageRequirements {
  required: string[];
  optional: string[];
  devOnly: string[];
}

/**
 * Preset type categories
 */
export type PresetType = 'backend' | 'subscriber' | 'plugin' | 'platform';

/**
 * Protocol for OTLP export
 */
export type OtlpProtocol = 'http' | 'grpc';

/**
 * Base preset definition
 */
export interface Preset {
  name: string;
  slug: string;
  type: PresetType;
  description: string;
  packages: PackageRequirements;
  env: {
    required: EnvVar[];
    optional: EnvVar[];
  };
  imports: Import[];
  configBlock: ConfigBlock;
  nextSteps: string[];
}

/**
 * Backend preset with protocol info
 */
export interface BackendPreset extends Preset {
  type: 'backend';
  protocol: OtlpProtocol;
  exporter: 'otlp-http' | 'otlp-grpc';
}

/**
 * Subscriber preset
 */
export interface SubscriberPreset extends Preset {
  type: 'subscriber';
}

/**
 * Plugin preset
 */
export interface PluginPreset extends Preset {
  type: 'plugin';
}

/**
 * Platform preset
 */
export interface PlatformPreset extends Preset {
  type: 'platform';
}

/**
 * Quick preset bundle (e.g., node-datadog-pino)
 */
export interface QuickPreset {
  name: string;
  slug: string;
  description: string;
  backend: string;
  logging?: string;
  autoInstrumentations: 'all' | 'none' | string[];
  subscribers?: string[];
  plugins?: string[];
}

/**
 * Preset registry type
 */
export interface PresetRegistry {
  backends: Map<string, BackendPreset>;
  subscribers: Map<string, SubscriberPreset>;
  plugins: Map<string, PluginPreset>;
  platforms: Map<string, PlatformPreset>;
  quick: Map<string, QuickPreset>;
}
