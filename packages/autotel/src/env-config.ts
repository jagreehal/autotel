/**
 * Standard OpenTelemetry environment variables
 */
import type { Sampler as OtelSampler } from '@opentelemetry/sdk-trace-base';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

export interface OtelEnvVars {
  OTEL_SERVICE_NAME?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  OTEL_RESOURCE_ATTRIBUTES?: string;
  OTEL_EXPORTER_OTLP_PROTOCOL?: 'http' | 'grpc';
  OTEL_TRACES_SAMPLER?: string;
  OTEL_TRACES_SAMPLER_ARG?: string;
}

/**
 * Parsed resource attributes as key-value pairs
 */
export interface ResourceAttributes {
  [key: string]: string;
}

/**
 * Parsed OTLP headers as key-value pairs
 */
export interface OtlpHeaders {
  [key: string]: string;
}

/**
 * Environment-resolved configuration (subset of AutotelConfig)
 * Defined locally to avoid circular dependency with init.ts
 */
export interface EnvConfig {
  service?: string;
  endpoint?: string;
  protocol?: 'http' | 'grpc';
  headers?: Record<string, string>;
  resourceAttributes?: Record<string, string>;
  otelSampler?: OtelSampler;
}

/**
 * Validate URL format
 */
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolve OpenTelemetry environment variables from process.env
 */
export function resolveOtelEnv(): OtelEnvVars {
  const env: OtelEnvVars = {};

  // OTEL_SERVICE_NAME - optional string
  if (process.env.OTEL_SERVICE_NAME) {
    const value = process.env.OTEL_SERVICE_NAME.trim();
    if (value) {
      env.OTEL_SERVICE_NAME = value;
    }
  }

  // OTEL_EXPORTER_OTLP_ENDPOINT - optional URL
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const value = process.env.OTEL_EXPORTER_OTLP_ENDPOINT.trim();
    if (value && isValidUrl(value)) {
      env.OTEL_EXPORTER_OTLP_ENDPOINT = value;
    }
  }

  // OTEL_EXPORTER_OTLP_HEADERS - optional string
  if (process.env.OTEL_EXPORTER_OTLP_HEADERS) {
    const value = process.env.OTEL_EXPORTER_OTLP_HEADERS.trim();
    if (value) {
      env.OTEL_EXPORTER_OTLP_HEADERS = value;
    }
  }

  // OTEL_RESOURCE_ATTRIBUTES - optional string
  if (process.env.OTEL_RESOURCE_ATTRIBUTES) {
    const value = process.env.OTEL_RESOURCE_ATTRIBUTES.trim();
    if (value) {
      env.OTEL_RESOURCE_ATTRIBUTES = value;
    }
  }

  // OTEL_EXPORTER_OTLP_PROTOCOL - optional enum ('http' | 'grpc')
  if (process.env.OTEL_EXPORTER_OTLP_PROTOCOL) {
    const value = process.env.OTEL_EXPORTER_OTLP_PROTOCOL.trim().toLowerCase();
    if (value === 'http' || value === 'grpc') {
      env.OTEL_EXPORTER_OTLP_PROTOCOL = value;
    }
  }

  if (process.env.OTEL_TRACES_SAMPLER) {
    const value = process.env.OTEL_TRACES_SAMPLER.trim();
    if (value) {
      env.OTEL_TRACES_SAMPLER = value;
    }
  }

  if (process.env.OTEL_TRACES_SAMPLER_ARG) {
    const value = process.env.OTEL_TRACES_SAMPLER_ARG.trim();
    if (value) {
      env.OTEL_TRACES_SAMPLER_ARG = value;
    }
  }

  return env;
}

function parseRatioSamplerArg(
  samplerName: string,
  samplerArg: string | undefined,
): number {
  if (samplerArg === undefined) {
    return 1.0;
  }

  const ratio = Number(samplerArg);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    console.error(
      `[autotel] Invalid OTEL_TRACES_SAMPLER_ARG="${samplerArg}" for ${samplerName}. Expected a number in [0..1]. Falling back to 1.0.`,
    );
    return 1.0;
  }

  return ratio;
}

function warnOnUnusedSamplerArg(
  samplerName: string,
  samplerArg: string | undefined,
): void {
  if (samplerArg !== undefined) {
    console.error(
      `[autotel] OTEL_TRACES_SAMPLER_ARG is not used by OTEL_TRACES_SAMPLER="${samplerName}". Ignoring value "${samplerArg}".`,
    );
  }
}

export function createSamplerFromEnv(
  env: Pick<OtelEnvVars, 'OTEL_TRACES_SAMPLER' | 'OTEL_TRACES_SAMPLER_ARG'>,
): OtelSampler | undefined {
  const samplerName = env.OTEL_TRACES_SAMPLER;
  if (!samplerName) {
    return undefined;
  }

  switch (samplerName) {
    case 'always_on':
      warnOnUnusedSamplerArg(samplerName, env.OTEL_TRACES_SAMPLER_ARG);
      return new AlwaysOnSampler();
    case 'always_off':
      warnOnUnusedSamplerArg(samplerName, env.OTEL_TRACES_SAMPLER_ARG);
      return new AlwaysOffSampler();
    case 'traceidratio':
      return new TraceIdRatioBasedSampler(
        parseRatioSamplerArg(samplerName, env.OTEL_TRACES_SAMPLER_ARG),
      );
    case 'parentbased_always_on':
      warnOnUnusedSamplerArg(samplerName, env.OTEL_TRACES_SAMPLER_ARG);
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    case 'parentbased_always_off':
      warnOnUnusedSamplerArg(samplerName, env.OTEL_TRACES_SAMPLER_ARG);
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case 'parentbased_traceidratio':
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(
          parseRatioSamplerArg(samplerName, env.OTEL_TRACES_SAMPLER_ARG),
        ),
      });
    case 'jaeger_remote':
    case 'parentbased_jaeger_remote':
    case 'xray':
      console.error(
        `[autotel] OTEL_TRACES_SAMPLER="${samplerName}" is not supported yet by autotel. Falling back to the next sampler source.`,
      );
      return undefined;
    default:
      console.error(
        `[autotel] Unknown OTEL_TRACES_SAMPLER="${samplerName}". Falling back to the next sampler source.`,
      );
      return undefined;
  }
}

/**
 * Parse OTEL_RESOURCE_ATTRIBUTES from comma-separated key=value pairs
 * Example: "service.version=1.0.0,deployment.environment=production"
 */
export function parseResourceAttributes(
  input: string | undefined,
): ResourceAttributes {
  if (!input || input.trim() === '') {
    return {};
  }

  const attributes: ResourceAttributes = {};
  const pairs = input.split(',');

  for (const pair of pairs) {
    const trimmedPair = pair.trim();
    if (!trimmedPair) continue;

    const equalIndex = trimmedPair.indexOf('=');
    if (equalIndex === -1) {
      // Invalid format, skip this pair
      continue;
    }

    const key = trimmedPair.slice(0, equalIndex).trim();
    const value = trimmedPair.slice(equalIndex + 1).trim();

    if (key && value) {
      attributes[key] = value;
    }
  }

  return attributes;
}

/**
 * Parse OTEL_EXPORTER_OTLP_HEADERS from comma-separated key=value pairs
 * Example: "api-key=secret123,x-custom-header=value"
 */
export function parseOtlpHeaders(input: string | undefined): OtlpHeaders {
  if (!input || input.trim() === '') {
    return {};
  }

  const headers: OtlpHeaders = {};
  const pairs = input.split(',');

  for (const pair of pairs) {
    const trimmedPair = pair.trim();
    if (!trimmedPair) continue;

    const equalIndex = trimmedPair.indexOf('=');
    if (equalIndex === -1) {
      // Invalid format, skip this pair
      continue;
    }

    const key = trimmedPair.slice(0, equalIndex).trim();
    const value = trimmedPair.slice(equalIndex + 1).trim();

    if (key && value) {
      headers[key] = value;
    }
  }

  return headers;
}

/**
 * Convert resolved environment variables to config
 */
export function envToConfig(env: OtelEnvVars): EnvConfig {
  const config: EnvConfig = {};

  if (env.OTEL_SERVICE_NAME) {
    config.service = env.OTEL_SERVICE_NAME;
  }

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    config.endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  }

  if (env.OTEL_EXPORTER_OTLP_PROTOCOL) {
    config.protocol = env.OTEL_EXPORTER_OTLP_PROTOCOL;
  }

  if (env.OTEL_EXPORTER_OTLP_HEADERS) {
    config.headers = parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);
  }

  const resourceAttrs = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
  if (Object.keys(resourceAttrs).length > 0) {
    config.resourceAttributes = resourceAttrs;
  }

  const sampler = createSamplerFromEnv(env);
  if (sampler) {
    config.otelSampler = sampler;
  }

  return config;
}

/**
 * Main function to resolve config from environment variables
 */
export function resolveConfigFromEnv(): EnvConfig {
  const env = resolveOtelEnv();
  return envToConfig(env);
}
