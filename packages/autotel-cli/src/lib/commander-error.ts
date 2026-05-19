import { AutotelError } from './errors';

/**
 * Commander raises `CommanderError` (with a `.code` like
 * `commander.missingMandatoryOptionValue`) when validation fails before any
 * action runs. With `exitOverride()` set in `run()`, those errors propagate
 * to the top-level handler instead of `process.exit`ing — and this maps
 * them onto our validation envelope so agents see a parseable JSON failure
 * for every kind of error, not a raw stderr line.
 *
 * Returns `null` for anything that isn't a `CommanderError`, so the caller
 * can fall through to the generic error converter.
 *
 * Note: `commander.help`, `commander.helpDisplayed`, and `commander.version`
 * aren't really errors — commander already printed the requested output and
 * we just exit cleanly.
 */
export function commanderErrorToAutotel(error: unknown): AutotelError | null {
  if (
    error === null ||
    typeof error !== 'object' ||
    !('code' in error) ||
    typeof (error as { code: unknown }).code !== 'string' ||
    !(error as { code: string }).code.startsWith('commander.')
  ) {
    return null;
  }
  const ce = error as { code: string; message: string; exitCode?: number };
  if (
    ce.code === 'commander.help' ||
    ce.code === 'commander.helpDisplayed' ||
    ce.code === 'commander.version'
  ) {
    process.exit(ce.exitCode ?? 0);
  }
  return new AutotelError({
    type: 'validation',
    code: 'AUTOTEL_E_INVALID_FLAG',
    message: ce.message,
    retryable: false,
    expected: { commanderCode: ce.code },
  });
}
