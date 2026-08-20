/**
 * YAML configuration loader for autotel
 *
 * Supports:
 * - Auto-discovery of autotel.yaml in cwd
 * - AUTOTEL_CONFIG_FILE env var override
 * - Environment variable substitution: ${env:VAR} and ${env:VAR:-default}
 *
 * @example Auto-discovery
 * ```yaml
 * # autotel.yaml in project root
 * service:
 *   name: my-service
 * exporter:
 *   endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}
 * ```
 *
 * @example Explicit path
 * ```bash
 * AUTOTEL_CONFIG_FILE=./config/otel.yaml tsx --import autotel/auto src/index.ts
 * ```
 */

// namespace import for browser-bundler compat — see node-require.ts
import * as nodeFs from 'node:fs';
import path from 'node:path';
import type { AutotelConfig, OtlpSignal } from './init';
import {
  AdaptiveSampler,
  AlwaysSampler,
  NeverSampler,
  RandomSampler,
  type SamplingPreset,
} from './sampling';

/**
 * Lazy-load yaml parser (optional peer dependency)
 * Only loads when a YAML config file is actually found
 */
import { requireModule } from './node-require';
import { asRecord, asString } from './values';

/** A value as a YAML document carries it: scalars, sequences, mappings. */
export type YamlValue =
  string | number | boolean | null | YamlValue[] | YamlMapping;

/** A YAML mapping - keys the reader has not looked at yet. */
export interface YamlMapping {
  [key: string]: YamlValue;
}

function loadYamlParser(): (content: string) => YamlValue {
  try {
    const mod = requireModule<{ parse: (content: string) => YamlValue }>(
      'yaml',
    );
    return mod.parse;
  } catch {
    throw new Error('YAML parser not found. Install with: pnpm add yaml');
  }
}

/**
 * YAML config structure
 * Maps to AutotelConfig with user-friendly naming
 */
export interface YamlConfig {
  service?: {
    name?: string;
    version?: string;
    environment?: string;
  };
  exporter?: {
    endpoint?: string;
    protocol?: 'http' | 'http/protobuf' | 'grpc';
    headers?: Record<string, string>;
    destinations?: Array<{
      endpoint: string;
      protocol?: 'http' | 'http/protobuf' | 'grpc';
      headers?: Record<string, string>;
      signals?: OtlpSignal[];
    }>;
  };
  resource?: Record<string, string | number | boolean>;
  sampling?: {
    preset?: SamplingPreset;
    type?: 'adaptive' | 'always_on' | 'always_off' | 'ratio';
    ratio?: number;
    baseline_rate?: number;
    always_sample_errors?: boolean;
    always_sample_slow?: boolean;
    slow_threshold_ms?: number;
  };
  autoInstrumentations?: string[] | Record<string, { enabled?: boolean }>;
  /** Path to a policy `.json` file or a directory of them (OTEP 4738). */
  policies?: string;
  debug?: boolean;
}

/**
 * Environment variable substitution regex
 * Matches ${env:VAR_NAME} and ${env:VAR_NAME:-default}
 */
const ENV_VAR_PATTERN = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Substitute ${env:VAR} and ${env:VAR:-default} in a string
 *
 * @param value - String potentially containing env var references
 * @returns String with env vars substituted
 *
 * @example
 * substituteEnvVars('${env:NODE_ENV:-development}')
 * // Returns 'production' if NODE_ENV=production, else 'development'
 */
function substituteEnvVars(value: string): string {
  return value.replaceAll(
    ENV_VAR_PATTERN,
    (_match, varName: string, defaultValue?: string) => {
      const envValue = process.env[varName];
      if (envValue !== undefined) return envValue;
      if (defaultValue !== undefined) return defaultValue;
      console.warn(
        `[autotel] Environment variable ${varName} not set and no default provided`,
      );
      return '';
    },
  );
}

/**
 * Recursively substitute env vars in an object
 *
 * @param obj - Object to process
 * @returns Object with all string values having env vars substituted
 */
function substituteEnvVarsDeep(value: YamlValue): YamlValue {
  if (Array.isArray(value)) return value.map(substituteEnvVarsDeep);

  const mapping = asYamlMapping(value);
  if (mapping) {
    const result: YamlMapping = {};
    for (const [key, entry] of Object.entries(mapping)) {
      result[key] = substituteEnvVarsDeep(entry);
    }
    return result;
  }

  const text = asString(value);
  return text === undefined ? value : substituteEnvVars(text);
}

/** The mapping a YAML value is, when it is one. */
function asYamlMapping(value: YamlValue): YamlMapping | undefined {
  // SAFETY: a YamlValue that is a non-array object has only one arm it can be,
  // and that is a mapping.
  return asRecord(value) === undefined ? undefined : (value as YamlMapping);
}

/**
 * A YAML document read into the config shape, with `${env:...}` placeholders
 * resolved.
 *
 * This is the boundary: the file is text until here. Every field of
 * YamlConfig is optional, so any document satisfies it, and
 * `yamlToAutotelConfig` picks out only the fields it understands.
 */
function parseYamlConfig(content: string): YamlConfig {
  const substituted = substituteEnvVarsDeep(loadYamlParser()(content));
  // SAFETY: see above - YamlConfig describes the fields this reader looks for,
  // not a shape the document is required to have.
  return (asYamlMapping(substituted) ?? {}) as YamlConfig;
}

/**
 * Find YAML config file path
 *
 * Priority:
 * 1. AUTOTEL_CONFIG_FILE env var (explicit path)
 * 2. autotel.yaml in cwd (convention)
 * 3. autotel.yml in cwd (alternative extension)
 *
 * @returns File path if found, null otherwise
 */
function findConfigFile(): string | null {
  // Check env var first (explicit takes priority)
  const envPath = process.env.AUTOTEL_CONFIG_FILE;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (nodeFs.existsSync(resolved)) return resolved;
    console.warn(`[autotel] Config file not found: ${envPath}`);
    return null;
  }

  // Auto-discover autotel.yaml in cwd
  const conventionPath = path.resolve(process.cwd(), 'autotel.yaml');
  if (nodeFs.existsSync(conventionPath)) return conventionPath;

  // Also check .yml extension
  const altPath = path.resolve(process.cwd(), 'autotel.yml');
  if (nodeFs.existsSync(altPath)) return altPath;

  return null;
}

/**
 * Convert YAML config structure to AutotelConfig
 *
 * @param yaml - Parsed and env-substituted YAML config
 * @returns Partial AutotelConfig ready for merging
 */
function yamlToAutotelConfig(yaml: YamlConfig): Partial<AutotelConfig> {
  const config: Partial<AutotelConfig> = {};

  // Service configuration
  if (yaml.service?.name) config.service = yaml.service.name;
  if (yaml.service?.version) config.version = yaml.service.version;
  if (yaml.service?.environment) config.environment = yaml.service.environment;

  // Exporter configuration
  if (yaml.exporter?.endpoint) config.endpoint = yaml.exporter.endpoint;
  if (yaml.exporter?.protocol) config.protocol = yaml.exporter.protocol;
  if (yaml.exporter?.headers) config.headers = yaml.exporter.headers;
  if (yaml.exporter?.destinations) {
    config.destinations = yaml.exporter.destinations;
  }

  // Resource attributes (flattened)
  if (yaml.resource) config.resourceAttributes = yaml.resource;

  // Integrations
  if (yaml.autoInstrumentations)
    config.autoInstrumentations = yaml.autoInstrumentations;

  // Telemetry Policies (OTEP 4738)
  if (yaml.policies) config.policies = yaml.policies;

  // Debug mode
  if (yaml.debug !== undefined) config.debug = yaml.debug;

  // Sampling configuration
  if (yaml.sampling?.preset) {
    warnOnIgnoredPresetOverrides(yaml.sampling);
    config.sampling = yaml.sampling.preset;
  } else {
    const sampler = createSamplerFromYaml(yaml.sampling);
    if (sampler) config.sampler = sampler;
  }

  return config;
}

function createSamplerFromYaml(
  sampling?: YamlConfig['sampling'],
): AutotelConfig['sampler'] {
  if (!sampling) return undefined;
  if (sampling.preset) return undefined;

  const type = sampling.type ?? 'adaptive';

  try {
    switch (type) {
      case 'adaptive': {
        return new AdaptiveSampler({
          baselineSampleRate: sampling.baseline_rate,
          alwaysSampleErrors: sampling.always_sample_errors,
          alwaysSampleSlow: sampling.always_sample_slow,
          slowThresholdMs: sampling.slow_threshold_ms,
        });
      }
      case 'always_on': {
        return new AlwaysSampler();
      }
      case 'always_off': {
        return new NeverSampler();
      }
      case 'ratio': {
        if (sampling.ratio === undefined) {
          console.warn(
            '[autotel] sampling.ratio missing in YAML sampling config. Falling back to adaptive sampler.',
          );
          return new AdaptiveSampler();
        }
        return new RandomSampler(sampling.ratio);
      }
      default: {
        console.warn(
          `[autotel] Unknown sampling type "${type}" in YAML config. Falling back to defaults.`,
        );
        return undefined;
      }
    }
  } catch (error) {
    console.warn(
      `[autotel] Failed to configure sampling from YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function warnOnIgnoredPresetOverrides(
  sampling: NonNullable<YamlConfig['sampling']>,
): void {
  const presetOverriddenFields = [
    'type',
    'ratio',
    'baseline_rate',
    'always_sample_errors',
    'always_sample_slow',
    'slow_threshold_ms',
  ] as const satisfies readonly (keyof typeof sampling)[];
  const ignoredFields = presetOverriddenFields.filter(
    (field) => sampling[field] !== undefined,
  );

  if (ignoredFields.length === 0) {
    return;
  }

  console.warn(
    `[autotel] sampling.preset="${sampling.preset}" ignores these YAML fields: ${ignoredFields.join(', ')}. ` +
      'Use the programmatic API with sampler or samplingPresets.*(...) for tuned presets.',
  );
}

/**
 * Load and parse YAML config file (auto-discovery)
 *
 * Automatically finds and loads autotel.yaml or uses AUTOTEL_CONFIG_FILE.
 * Returns null if no config file found (not an error - YAML config is optional).
 *
 * @returns Partial AutotelConfig or null if no config file found
 *
 * @example
 * const yamlConfig = loadYamlConfig();
 * if (yamlConfig) {
 *   init({ ...yamlConfig, debug: true });
 * }
 */
export function loadYamlConfig(): Partial<AutotelConfig> | null {
  const filePath = findConfigFile();
  if (!filePath) return null;

  try {
    const content = nodeFs.readFileSync(filePath, 'utf8');
    return yamlToAutotelConfig(parseYamlConfig(content));
  } catch (error) {
    console.error(
      `[autotel] Failed to load YAML config from ${filePath}:`,
      error,
    );
    return null;
  }
}

/**
 * Load YAML config from a specific file path
 *
 * Unlike loadYamlConfig(), this throws if the file cannot be read.
 *
 * @param filePath - Path to YAML config file
 * @returns Partial AutotelConfig
 * @throws Error if file cannot be read or parsed
 *
 * @example
 * import { loadYamlConfigFromFile } from 'autotel/yaml';
 * import { init } from 'autotel';
 *
 * const config = loadYamlConfigFromFile('./config/otel.yaml');
 * init({ ...config, debug: true });
 */
export function loadYamlConfigFromFile(
  filePath: string,
): Partial<AutotelConfig> {
  const resolved = path.resolve(filePath);
  const content = nodeFs.readFileSync(resolved, 'utf8');
  return yamlToAutotelConfig(parseYamlConfig(content));
}

/**
 * Check if a YAML config file exists (without loading it)
 *
 * @returns true if a config file would be found by loadYamlConfig()
 */
export function hasYamlConfig(): boolean {
  return findConfigFile() !== null;
}
