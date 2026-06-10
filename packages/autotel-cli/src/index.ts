import { run } from './cli';
import {
  AutotelError,
  exitCodeForError,
  toAutotelError,
} from './lib/errors';
import { commanderErrorToAutotel } from './lib/commander-error';
import { printJson } from './lib/json-output';

/**
 * --json mode is detected from argv so the top-level handler can emit a
 * structured envelope even when an error fires before commander's action
 * runs (e.g. unknown command).
 */
function jsonModeRequested(): boolean {
  return process.argv.includes('--json');
}

run().catch((error: unknown) => {
  const err: AutotelError =
    commanderErrorToAutotel(error) ?? toAutotelError(error);
  const isJson =
    jsonModeRequested() ||
    // schema/commands/examples/version + investigate commands are JSON-only
    /^(schema|commands|examples|version|health|capabilities|discover|query|trace|diagnose|topology|correlate|llm|semconv|score|collector|security)\b/.test(
      process.argv.slice(2).join(' ')
    );

  if (isJson) {
    printJson(err.toEnvelope());
  } else {
    process.stderr.write(
      `Error [${err.code}]: ${err.message}\n` +
        (err.fix !== undefined ? `Fix: ${err.fix}\n` : '')
    );
  }
  process.exit(exitCodeForError(err));
});
