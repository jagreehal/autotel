import type { AppConfig, BackendHandle, TelemetryBackend } from 'autotel-mcp';
import { AutotelError } from '../../lib/errors';
import { configureJsonOutput, printJson } from '../../lib/json-output';

/**
 * Common flags accepted by every `autotel investigate*` subcommand. Mirrors
 * the env vars autotel-mcp's `loadConfig()` consumes, so a user can pick a
 * backend with either CLI flags or the same env vars they'd use for the MCP
 * server. Flags win when both are set.
 */
export interface InvestigateFlags {
  backend?: AppConfig['backend'];
  jaegerBaseUrl?: string;
  tempoBaseUrl?: string;
  prometheusBaseUrl?: string;
  lokiBaseUrl?: string;
  collectorPort?: number;
  fixturePath?: string;
  outputFile?: string;
  noSecrets?: boolean;
}

/**
 * Apply CLI flags onto process.env before loadConfig() runs. autotel-mcp's
 * config is env-driven; this is the smallest seam that lets us override
 * without duplicating the schema in CLI-land.
 */
function applyFlagsToEnv(flags: InvestigateFlags): void {
  if (flags.backend !== undefined) process.env.AUTOTEL_BACKEND = flags.backend;
  if (flags.jaegerBaseUrl !== undefined)
    process.env.JAEGER_BASE_URL = flags.jaegerBaseUrl;
  if (flags.tempoBaseUrl !== undefined)
    process.env.TEMPO_BASE_URL = flags.tempoBaseUrl;
  if (flags.prometheusBaseUrl !== undefined)
    process.env.PROMETHEUS_BASE_URL = flags.prometheusBaseUrl;
  if (flags.lokiBaseUrl !== undefined)
    process.env.LOKI_BASE_URL = flags.lokiBaseUrl;
  if (flags.collectorPort !== undefined)
    process.env.AUTOTEL_COLLECTOR_PORT = String(flags.collectorPort);
  if (flags.fixturePath !== undefined)
    process.env.AUTOTEL_FIXTURE_PATH = flags.fixturePath;
}

/**
 * Build a backend from CLI flags/env. Caller is responsible for calling
 * `handle.start()` / `handle.stop()` if the chosen backend needs lifecycle
 * (e.g. the collector OTLP receiver). Most read-only investigation calls
 * don't need start, so prefer `withBackend()` which handles it for you.
 */
export async function openBackend(
  flags: InvestigateFlags,
): Promise<BackendHandle> {
  applyFlagsToEnv(flags);
  // Lazy import keeps autotel-mcp's heavy deps out of the cold-start path of
  // `autotel init` / `autotel doctor`. Only investigate commands pay the cost.
  const { loadConfig, createBackend } = await import('autotel-mcp');
  const config = loadConfig();
  return createBackend(config);
}

/**
 * Standard envelope for commands that don't need a backend (semconv,
 * instrumentation scoring, collector schema lookups — these talk to upstream
 * GitHub catalogs or operate on input only).
 */
export async function runStatic<T>(
  command: string,
  flags: Pick<InvestigateFlags, 'outputFile' | 'noSecrets'>,
  fn: () => Promise<T>,
): Promise<void> {
  configureJsonOutput({
    outputFile: flags.outputFile,
    noSecrets: flags.noSecrets,
  });
  try {
    const data = await fn();
    printJson({ ok: true, command, data });
  } catch (error) {
    throw toInvestigateError(command, error);
  }
}

/**
 * Standard envelope around an investigate command: open backend, run the
 * caller's logic, print JSON, exit cleanly. Errors are converted to the
 * existing AutotelError envelope so the top-level handler in index.ts can
 * pick exit codes consistently.
 */
export async function runInvestigate<T>(
  command: string,
  flags: InvestigateFlags,
  fn: (backend: TelemetryBackend) => Promise<T>,
): Promise<void> {
  configureJsonOutput({
    outputFile: flags.outputFile,
    noSecrets: flags.noSecrets,
  });

  let handle: BackendHandle | null = null;
  try {
    handle = await openBackend(flags);
    // Only start if the backend exposes lifecycle (collector listener).
    // Read-only backends (jaeger/tempo/prom/loki/fixture) have a no-op start.
    await handle.start();
    const data = await fn(handle.backend);
    printJson({ ok: true, command, data });
  } catch (error) {
    throw toInvestigateError(command, error);
  } finally {
    if (handle) {
      try {
        await handle.stop();
      } catch {
        // Stop failures shouldn't mask the original result.
      }
    }
  }
}

export function toInvestigateError(command: string, error: unknown): AutotelError {
  if (error instanceof AutotelError) return error;
  // ZodError surfaces from `loadConfig()` (bad --backend value) and from any
  // shared query schema. Detect by shape (`error.issues` array) so we don't
  // need a runtime zod dependency in CLI-land.
  if (
    error !== null &&
    typeof error === 'object' &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  ) {
    const issues = (error as { issues: Array<{ path?: unknown[]; message: string; code?: string; values?: unknown[] }> }).issues;
    const first = issues[0];
    const path = first?.path?.join('.') ?? '';
    return new AutotelError({
      type: 'validation',
      code: 'AUTOTEL_E_INVALID_INPUT',
      message: `autotel ${command}: invalid input${path ? ` for "${path}"` : ''} — ${first?.message ?? 'validation failed'}`,
      retryable: false,
      expected: { issues },
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AutotelError({
    type: 'runtime',
    code: 'AUTOTEL_E_UNKNOWN',
    message: `autotel ${command} failed: ${message}`,
    retryable: false,
  });
}
