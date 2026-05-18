/**
 * Structured error envelope for agent-native CLI usage.
 *
 * Inspired by the wrangler-deploy / agent-native CLI design: errors carry a
 * stable code (AUTOTEL_E_*), a type bucket, a human message, an optional
 * `fix` hint, and a structured `expected` payload so agents can recover
 * without scraping prose.
 */

/**
 * Error type buckets. Stable enum.
 */
export type AutotelErrorType =
  | 'validation' // Bad input / missing required args
  | 'environment' // Missing files, no package.json, wrong CWD
  | 'auth' // Missing/invalid credentials
  | 'conflict' // Existing config, ambiguous workspace
  | 'install' // Package install failed
  | 'io' // File read/write failed
  | 'runtime'; // Catch-all unexpected failure

/**
 * Stable error codes. Append-only — never rename or repurpose an existing code.
 */
export const AutotelErrorCodes = {
  // validation
  E_NO_PACKAGE_JSON: 'AUTOTEL_E_NO_PACKAGE_JSON',
  E_UNKNOWN_PRESET: 'AUTOTEL_E_UNKNOWN_PRESET',
  E_INVALID_PLAN: 'AUTOTEL_E_INVALID_PLAN',
  E_INVALID_INPUT: 'AUTOTEL_E_INVALID_INPUT',
  E_INVALID_FLAG: 'AUTOTEL_E_INVALID_FLAG',
  // environment
  E_NO_WORKSPACE_PACKAGES: 'AUTOTEL_E_NO_WORKSPACE_PACKAGES',
  E_ENV_CONSENT_REQUIRED: 'AUTOTEL_E_ENV_CONSENT_REQUIRED',
  // conflict
  E_EXISTING_CONFIG: 'AUTOTEL_E_EXISTING_CONFIG',
  E_AMBIGUOUS_LOGGER: 'AUTOTEL_E_AMBIGUOUS_LOGGER',
  // install
  E_INSTALL_FAILED: 'AUTOTEL_E_INSTALL_FAILED',
  // io
  E_WRITE_FAILED: 'AUTOTEL_E_WRITE_FAILED',
  E_READ_FAILED: 'AUTOTEL_E_READ_FAILED',
  // runtime
  E_UNKNOWN: 'AUTOTEL_E_UNKNOWN',
} as const;

export type AutotelErrorCode =
  (typeof AutotelErrorCodes)[keyof typeof AutotelErrorCodes];

/**
 * Error envelope payload. This is what gets serialised in --json output.
 */
export interface AutotelErrorEnvelope {
  ok: false;
  command?: string;
  error: {
    type: AutotelErrorType;
    code: AutotelErrorCode;
    message: string;
    retryable: boolean;
    fix?: string;
    expected?: Record<string, unknown>;
    suggestions?: string[];
  };
}

/**
 * Throwable error class carrying envelope-shaped fields.
 *
 * Callers throw `new AutotelError({ ... })` instead of `process.exit(1)`.
 * The top-level CLI entry catches it, picks pretty vs JSON output, and exits
 * with the correct code (1 runtime, 2 validation/refusal).
 */
export class AutotelError extends Error {
  readonly type: AutotelErrorType;
  readonly code: AutotelErrorCode;
  readonly retryable: boolean;
  readonly fix?: string;
  readonly expected?: Record<string, unknown>;
  readonly suggestions?: string[];

  constructor(opts: {
    type: AutotelErrorType;
    code: AutotelErrorCode;
    message: string;
    retryable?: boolean;
    fix?: string;
    expected?: Record<string, unknown>;
    suggestions?: string[];
  }) {
    super(opts.message);
    this.name = 'AutotelError';
    this.type = opts.type;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.fix = opts.fix;
    this.expected = opts.expected;
    this.suggestions = opts.suggestions;
  }

  toEnvelope(command?: string): AutotelErrorEnvelope {
    return {
      ok: false,
      ...(command !== undefined ? { command } : {}),
      error: {
        type: this.type,
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.fix !== undefined ? { fix: this.fix } : {}),
        ...(this.expected !== undefined ? { expected: this.expected } : {}),
        ...(this.suggestions !== undefined
          ? { suggestions: this.suggestions }
          : {}),
      },
    };
  }
}

/**
 * Exit codes. Split following agent-native conventions:
 *   0 = success
 *   1 = runtime / unexpected failure
 *   2 = validation / refusal (caller-fixable)
 */
export function exitCodeForError(err: AutotelError): 1 | 2 {
  if (err.type === 'validation' || err.type === 'conflict') {
    return 2;
  }
  return 1;
}

/**
 * Wrap an unknown thrown value in an AutotelError envelope.
 */
export function toAutotelError(value: unknown): AutotelError {
  if (value instanceof AutotelError) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new AutotelError({
    type: 'runtime',
    code: AutotelErrorCodes.E_UNKNOWN,
    message,
  });
}
