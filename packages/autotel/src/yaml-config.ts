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

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { AutotelConfig } from './init';
import {
  AdaptiveSampler,
  AlwaysSampler,
  NeverSampler,
  RandomSampler,
} from './sampling';

/**
 * Lazy-load yaml parser (optional peer dependency)
 * Only loads when a YAML config file is actually found
 */
import { requireModule } from './node-require';

function loadYamlParser(): (content: string) => unknown {
  try {
    const mod = requireModule<{ parse: (content: string) => unknown }>('yaml');
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
    protocol?: 'http' | 'grpc';
    headers?: Record<string, string>;
  };
  resource?: Record<string, string | number | boolean>;
  sampling?: {
    type?: 'adaptive' | 'always_on' | 'always_off' | 'ratio';
    ratio?: number;
    baseline_rate?: number;
    always_sample_errors?: boolean;
    always_sample_slow?: boolean;
    slow_threshold_ms?: number;
  };
  autoInstrumentations?: string[] | Record<string, { enabled?: boolean }>;
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
function substituteEnvVarsDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteEnvVarsDeep(item));
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVarsDeep(value);
    }
    return result;
  }
  return obj;
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
    if (existsSync(resolved)) return resolved;
    console.warn(`[autotel] Config file not found: ${envPath}`);
    return null;
  }

  // Auto-discover autotel.yaml in cwd
  const conventionPath = path.resolve(process.cwd(), 'autotel.yaml');
  if (existsSync(conventionPath)) return conventionPath;

  // Also check .yml extension
  const altPath = path.resolve(process.cwd(), 'autotel.yml');
  if (existsSync(altPath)) return altPath;

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

  // Resource attributes (flattened)
  if (yaml.resource) config.resourceAttributes = yaml.resource;

  // Integrations
  if (yaml.autoInstrumentations)
    config.autoInstrumentations = yaml.autoInstrumentations;

  // Debug mode
  if (yaml.debug !== undefined) config.debug = yaml.debug;

  // Sampling configuration
  const sampler = createSamplerFromYaml(yaml.sampling);
  if (sampler) config.sampler = sampler;

  return config;
}

function createSamplerFromYaml(
  sampling?: YamlConfig['sampling'],
): AutotelConfig['sampler'] {
  if (!sampling) return undefined;

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
    const content = readFileSync(filePath, 'utf8');
    const parseYaml = loadYamlParser();
    const rawYaml = parseYaml(content) as YamlConfig;
    const substituted = substituteEnvVarsDeep(rawYaml) as YamlConfig;
    return yamlToAutotelConfig(substituted);
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
  const content = readFileSync(resolved, 'utf8');
  const parseYaml = loadYamlParser();
  const rawYaml = parseYaml(content) as YamlConfig;
  const substituted = substituteEnvVarsDeep(rawYaml) as YamlConfig;
  return yamlToAutotelConfig(substituted);
}

/**
 * Check if a YAML config file exists (without loading it)
 *
 * @returns true if a config file would be found by loadYamlConfig()
 */
export function hasYamlConfig(): boolean {
  return findConfigFile() !== null;
}
