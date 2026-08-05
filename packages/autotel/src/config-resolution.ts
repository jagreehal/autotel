/**
 * Turning a config object plus the environment into the values `init()` acts
 * on: which signals are on, which endpoint each one goes to, what gets
 * redacted, and what the process can tell us about itself.
 *
 * Every function here is pure with respect to autotel's state — inputs in,
 * decision out — which is what makes the precedence rules testable without
 * standing up an SDK.
 */

import type {
  AttributeRedactorConfig,
  AttributeRedactorPreset,
} from './attribute-redacting-processor';
import { requireModule } from './node-require';
import {
  resolveProtocol,
  type AutotelProtocol,
  type OtlpSignal,
} from './otlp-exporters';
import type { AutotelConfig } from './autotel-config';

/**
 * Resolve the effective attribute redactor. Explicit config wins (`false`
 * disables). Otherwise the `AUTOTEL_REDACT_PII` env var controls it, and as a
 * final default PII redaction is auto-enabled in production.
 */
export function resolveAttributeRedactor(
  explicit:
    AttributeRedactorConfig | AttributeRedactorPreset | false | undefined,
  environment: string,
): AttributeRedactorConfig | AttributeRedactorPreset | undefined {
  if (explicit === false) return undefined;
  if (explicit !== undefined) return explicit;

  const flag = process.env.AUTOTEL_REDACT_PII?.trim().toLowerCase();
  if (flag) {
    if (['off', 'false', '0', 'none', 'disabled'].includes(flag)) {
      return undefined;
    }
    if (flag === 'default' || flag === 'strict' || flag === 'pci-dss') {
      return flag;
    }
    if (['on', 'true', '1', 'enabled'].includes(flag)) {
      return 'default';
    }
  }

  return environment === 'production' ? 'default' : undefined;
}

/**
 * Read a duration-in-milliseconds environment variable, ignoring anything that
 * is not a positive number so a typo falls back to the SDK default rather than
 * throwing at startup.
 */
export function readMillisEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function detectEnvironmentAttributes(): Record<string, string> {
  const attrs: Record<string, string> = {};

  const commitSha =
    process.env.COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.AWS_CODEPIPELINE_EXECUTION_ID;
  if (commitSha) attrs['service.commit.sha'] = commitSha;

  const region =
    process.env.VERCEL_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.FLY_REGION ||
    process.env.CF_REGION ||
    process.env.GOOGLE_CLOUD_REGION;
  if (region) attrs['service.region'] = region;

  const version =
    process.env.APP_VERSION ||
    process.env.HEROKU_RELEASE_VERSION ||
    process.env.VERCEL_GIT_COMMIT_REF;
  if (version) attrs['service.deploy.version'] = version;

  return attrs;
}

/**
 * Resolve metrics flag with env var override support
 */
export function resolveMetricsFlag(
  configFlag: boolean | 'auto' = 'auto',
): boolean {
  // 1. Check env var override (highest priority)
  const envFlag = process.env.AUTOTEL_METRICS;
  if (envFlag === 'on' || envFlag === 'true') return true;
  if (envFlag === 'off' || envFlag === 'false') return false;

  // 2. Check config flag
  if (configFlag === true) return true;
  if (configFlag === false) return false;

  // 3. Default: enabled in all environments (simpler)
  return true;
}

/**
 * Resolve logs flag with env var override support.
 * Defaults to disabled (opt-in only) to avoid unexpected log export
 * and to preserve the upstream SDK's OTEL_LOGS_EXPORTER handling.
 */
export function resolveLogsFlag(
  configFlag: boolean | 'auto' = 'auto',
): boolean {
  // 1. Check env var override (highest priority)
  const envFlag = process.env.AUTOTEL_LOGS;
  if (envFlag === 'on' || envFlag === 'true') return true;
  if (envFlag === 'off' || envFlag === 'false') return false;

  // 2. Check config flag
  if (configFlag === true) return true;
  if (configFlag === false) return false;

  // 3. Default: disabled (opt-in only)
  return false;
}

/**
 * Resolve debug flag with env var override support
 *
 * Supports:
 * - `'pretty'`: Colorized, hierarchical output (PrettyConsoleExporter)
 * - `true` / `'true'` / `'1'`: Raw JSON output (ConsoleSpanExporter)
 * - `false` / `'false'` / `'0'`: Disabled
 */
export function resolveDebugFlag(
  configFlag?: boolean | 'pretty',
): boolean | 'pretty' {
  // 1. Check env var override (highest priority)
  const envFlag = process.env.AUTOTEL_DEBUG;
  if (envFlag === 'pretty') return 'pretty';
  if (envFlag === 'true' || envFlag === '1') return true;
  if (envFlag === 'false' || envFlag === '0') return false;

  // 2. Return config flag (defaults to false)
  return configFlag ?? false;
}

export function normalizeOtlpHeaders(
  headers?: Record<string, string> | string,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (typeof headers !== 'string') return headers;

  const parsed: Record<string, string> = {};
  for (const pair of headers.split(',')) {
    const [key, ...valueParts] = pair.split('=');
    if (!key || valueParts.length === 0) continue;
    parsed[key.trim()] = valueParts.join('=').trim();
  }
  return parsed;
}

export type ResolvedOtlpDestination = {
  endpoint: string;
  protocol: AutotelProtocol;
  headers?: Record<string, string>;
  signals?: Set<OtlpSignal>;
};

export function resolveOtlpDestinations(
  config: AutotelConfig,
  fallbackEndpoint?: string,
): ResolvedOtlpDestination[] {
  const rawDestinations =
    config.destinations === undefined
      ? fallbackEndpoint
        ? [
            {
              endpoint: fallbackEndpoint,
              headers: config.headers,
              protocol: config.protocol,
            },
          ]
        : []
      : config.destinations;

  return rawDestinations.map((destination) => ({
    endpoint: destination.endpoint,
    protocol: resolveProtocol(destination.protocol ?? config.protocol),
    headers: normalizeOtlpHeaders(destination.headers ?? config.headers),
    signals: destination.signals ? new Set(destination.signals) : undefined,
  }));
}

export function destinationSupportsSignal(
  destination: ResolvedOtlpDestination,
  signal: OtlpSignal,
): boolean {
  return destination.signals ? destination.signals.has(signal) : true;
}

/**
 * Auto-detect version from package.json
 */
export function detectVersion(): string {
  try {
    // Try to read package.json from cwd using fs
    const fs = requireModule<typeof import('node:fs')>('node:fs');
    const pkg = JSON.parse(
      fs.readFileSync(`${process.cwd()}/package.json`, 'utf8'),
    );
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

/**
 * Detect hostname for resource attributes.
 * Supports Datadog conventions (DD_HOSTNAME) and falls back to system hostname.
 *
 * Priority order:
 * 1. DD_HOSTNAME environment variable (Datadog convention)
 * 2. HOSTNAME environment variable (common Unix convention)
 * 3. os.hostname() (system hostname)
 *
 * @returns hostname string or undefined if detection fails
 */
export function detectHostname(): string | undefined {
  // Priority 1: DD_HOSTNAME (Datadog convention)
  if (process.env.DD_HOSTNAME) {
    return process.env.DD_HOSTNAME;
  }

  // Priority 2: HOSTNAME (common in containers and Unix systems)
  if (process.env.HOSTNAME) {
    return process.env.HOSTNAME;
  }

  // Priority 3: System hostname
  try {
    const os = requireModule<typeof import('node:os')>('node:os');
    return os.hostname();
  } catch {
    // os module not available (edge runtime, browser, etc.)
    return undefined;
  }
}
