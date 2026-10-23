import { AutotelError } from './errors';
import { asNumber, asString, readProperty } from './values';

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
export function commanderErrorToAutotel(cause: unknown): AutotelError | null {
  const code = asString(readProperty(cause, 'code'));
  if (code === undefined || !code.startsWith('commander.')) {
    return null;
  }
  if (
    code === 'commander.help' ||
    code === 'commander.helpDisplayed' ||
    code === 'commander.version'
  ) {
    process.exit(asNumber(readProperty(cause, 'exitCode')) ?? 0);
  }
  return new AutotelError({
    type: 'validation',
    code: 'AUTOTEL_E_INVALID_FLAG',
    message: asString(readProperty(cause, 'message')) ?? '',
    retryable: false,
    expected: { commanderCode: code },
  });
}
