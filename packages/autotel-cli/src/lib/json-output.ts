import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from './fs';

/**
 * Module-level state for output configuration.
 *
 * Set once at command entry by `configureJsonOutput()`. Subsequent calls to
 * `printJson()` and `printJsonError()` use these settings. Module state is
 * deliberate: every output channel (success, error, watch tick) needs the
 * same redaction and artifact-persistence rules, and threading config
 * through every callsite would be noisy.
 */
let outputFilePath: string | null = null;
let outputFileWritten = false;
let outputRoot: string | null = null;
let redactSecrets = false;

/**
 * Configure JSON output for the current command invocation.
 */
export function configureJsonOutput(opts: {
  outputFile?: string;
  outputRoot?: string;
  noSecrets?: boolean;
}): void {
  outputFilePath = opts.outputFile ?? null;
  outputFileWritten = false;
  outputRoot = opts.outputRoot ?? null;
  redactSecrets =
    opts.noSecrets === true ||
    process.env['AUTOTEL_NO_SECRETS'] === '1' ||
    process.env['AGENT_SANDBOX'] === '1';
}

/**
 * Reset module state. Test helper.
 */
export function resetJsonOutput(): void {
  outputFilePath = null;
  outputFileWritten = false;
  outputRoot = null;
  redactSecrets = false;
}

const SECRET_KEY_PATTERN = /SECRET|TOKEN|PASSWORD|API[_-]?KEY|DSN/i;
const SECRET_VALUE_PATTERN = /^[A-Za-z0-9_\-+/=]{40,}$/;
const REDACTED = '[REDACTED]';

/**
 * Recursively redact secret-shaped values in a JSON-safe object.
 * Triggered by --no-secrets-in-output / AUTOTEL_NO_SECRETS=1 / AGENT_SANDBOX=1.
 */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((v) => redact(v));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && SECRET_KEY_PATTERN.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }

  if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
    return REDACTED;
  }

  return value;
}

/**
 * Print a JSON payload to stdout. If `--output-file` was configured, also
 * persist the first payload to disk (subsequent ticks only go to stdout to
 * avoid artifact churn on watch-style commands).
 */
export function printJson(data: unknown): void {
  const payload = redactSecrets ? redact(data) : data;
  const serialised = JSON.stringify(payload, null, 2);

  process.stdout.write(serialised + '\n');

  if (outputFilePath !== null && !outputFileWritten) {
    writeArtifactFile(outputFilePath, serialised);
    outputFileWritten = true;
  }
}

function writeArtifactFile(filePath: string, content: string): void {
  const resolved = path.resolve(filePath);
  if (outputRoot !== null) {
    atomicWrite(resolved, content, { root: outputRoot });
  } else {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');
  }
}
