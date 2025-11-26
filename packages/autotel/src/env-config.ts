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

  return env;
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
