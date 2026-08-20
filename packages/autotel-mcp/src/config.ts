import { z } from 'zod';
import { parseCliArgs, type ParsedArgs } from './cli-args';

const configSchema = z.object({
  backend: z
    .enum([
      'collector',
      'jaeger',
      'devtools',
      'tempo',
      'prometheus',
      'loki',
      'stack',
      'auto',
      'fixture',
      'logfire',
      'datadog',
      'signoz',
    ])
    .default('collector'),
  // No `sse`: the HTTP+SSE transport has been deprecated since protocol
  // 2025-03-26 and is scheduled for removal. `http` is Streamable HTTP, which
  // serves both the 2026-07-28 and 2025-era wire from one endpoint.
  transport: z
    .enum(['stdio', 'http'])
    .default('stdio')
    .describe('stdio or http (Streamable HTTP)'),
  port: z.coerce.number().default(3000),
  host: z.string().default('127.0.0.1'),
  collectorPort: z.coerce.number().default(4318),
  persist: z.string().optional(),
  retentionMs: z.coerce.number().optional(),
  maxTraces: z.coerce.number().default(10_000),
  jaegerBaseUrl: z.string().default('http://localhost:16686'),
  devtoolsBaseUrl: z.string().default('http://localhost:4318'),
  tempoBaseUrl: z.string().default('http://localhost:3200'),
  prometheusBaseUrl: z.string().default('http://localhost:9090'),
  lokiBaseUrl: z.string().default('http://localhost:3100'),
  fixturePath: z.string().default('./fixtures/telemetry.json'),
  // Hosted vendor backends. Credentials come from the environment only, never
  // from flags — argv is visible to any process that can list the process table.
  logfireBaseUrl: z.string().default('https://logfire-us.pydantic.dev'),
  logfireReadToken: z.string().default(''),
  // Accepts a bare Datadog site (`datadoghq.eu`) or a full API URL.
  datadogSite: z.string().default(''),
  datadogApiKey: z.string().default(''),
  datadogAppKey: z.string().default(''),
  signozBaseUrl: z.string().default('http://localhost:8080'),
  signozApiKey: z.string().default(''),
});

export type AppConfig = z.infer<typeof configSchema>;

export type Env = Record<string, string | undefined>;

/**
 * Resolves configuration from flags, then the environment, then defaults.
 *
 * `argv` and `env` are parameters rather than globals so the precedence rules
 * can be tested without mutating the process.
 *
 * `argv` defaults to empty rather than `process.argv`. A library embedding this
 * server has its own command line, and inheriting it would turn that caller's
 * unrelated flags into "unknown option" errors. The CLI passes argv in.
 */
export function loadConfig(
  argv: readonly string[] = [],
  env: Env = process.env,
): AppConfig {
  return resolveConfig(parseCliArgs(argv), env);
}

/**
 * The same resolution from an already-parsed command line, so a caller that
 * needs `--help`, `--version` or the error list does not parse argv a second
 * time and reach a different verdict about it.
 */
export function resolveConfig(
  parsed: ParsedArgs,
  env: Env = process.env,
): AppConfig {
  const { overrides, errors, warnings } = parsed;
  if (errors.length > 0) {
    throw new Error(`invalid arguments:\n  ${errors.join('\n  ')}`);
  }
  // Reported here rather than by the CLI so an embedder passing argv hears
  // about a flag we ignored too. Never fatal — see parseCliArgs.
  for (const warning of warnings) {
    console.error(`autotel-mcp: ${warning}`);
  }

  const read = (name: string): string | undefined =>
    overrides[name] ?? env[name];

  const raw = {
    backend: read('AUTOTEL_BACKEND'),
    transport: read('AUTOTEL_TRANSPORT'),
    port: read('AUTOTEL_PORT'),
    host: read('AUTOTEL_HOST'),
    collectorPort: read('AUTOTEL_COLLECTOR_PORT'),
    persist: read('AUTOTEL_PERSIST'),
    retentionMs: read('AUTOTEL_RETENTION_MS'),
    maxTraces: read('AUTOTEL_MAX_TRACES'),
    jaegerBaseUrl: read('JAEGER_BASE_URL'),
    devtoolsBaseUrl: read('DEVTOOLS_BASE_URL'),
    tempoBaseUrl: read('TEMPO_BASE_URL'),
    prometheusBaseUrl: read('PROMETHEUS_BASE_URL'),
    lokiBaseUrl: read('LOKI_BASE_URL'),
    fixturePath: read('AUTOTEL_FIXTURE_PATH'),
    logfireBaseUrl: read('LOGFIRE_BASE_URL'),
    // A region hostname, not a credential, so it has a flag like the rest.
    datadogSite: read('DD_SITE'),
    // Credentials are env-only; parseCliArgs rejects the flag forms.
    logfireReadToken: env.LOGFIRE_READ_TOKEN,
    datadogApiKey: env.DD_API_KEY,
    datadogAppKey: env.DD_APP_KEY,
    signozBaseUrl: read('SIGNOZ_BASE_URL'),
    signozApiKey: env.SIGNOZ_API_KEY,
  };

  const config = configSchema.parse(raw);

  // Default retention: 1h in-memory, 24h persistent
  if (config.retentionMs === undefined) {
    config.retentionMs = config.persist ? 86_400_000 : 3_600_000;
  }

  return config;
}
