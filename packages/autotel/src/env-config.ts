import { resolve } from 'node-env-resolver';
import { string, url, optional } from 'node-env-resolver/validators';

/**
 * Standard OpenTelemetry environment variables
 */
export interface OtelEnvVars {
  OTEL_SERVICE_NAME?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  OTEL_RESOURCE_ATTRIBUTES?: string;
  OTEL_EXPORTER_OTLP_PROTOCOL?: 'http' | 'grpc';
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
  otlpHeaders?: Record<string, string>;
  resourceAttributes?: Record<string, string>;
}

/**
 * Resolve OpenTelemetry environment variables using node-env-resolver
 */
export function resolveOtelEnv(): OtelEnvVars {
  return resolve({
    OTEL_SERVICE_NAME: string({ optional: true }),
    OTEL_EXPORTER_OTLP_ENDPOINT: url({ optional: true }),
    OTEL_EXPORTER_OTLP_HEADERS: string({ optional: true }),
    OTEL_RESOURCE_ATTRIBUTES: string({ optional: true }),
    OTEL_EXPORTER_OTLP_PROTOCOL: optional(['http', 'grpc'] as const),
  });
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
    config.otlpHeaders = parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);
  }

  const resourceAttrs = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
  if (Object.keys(resourceAttrs).length > 0) {
    config.resourceAttributes = resourceAttrs;
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
