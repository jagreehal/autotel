import {
  EstimateInputError,
  estimateCost,
  type EstimateInput,
  type EstimateResult,
} from 'autotel-mcp';
import { AutotelError, AutotelErrorCodes } from '../lib/errors';

export interface EstimateEnvelope {
  ok: true;
  command: 'estimate';
  estimate: EstimateResult;
}

/** `keepPercent` → `--keep-percent`, so the fix hint names a real flag. */
function flagFor(field: string): string {
  return `--${field.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Answer "what will this telemetry cost me a month" as a JSON envelope.
 *
 * Throws `AutotelError` rather than exiting, so the top-level handler picks
 * pretty or JSON output and maps the code — bad input is the caller's to fix
 * (exit 2), not a broken run (exit 1).
 */
export function runEstimate(input: EstimateInput): EstimateEnvelope {
  try {
    return {
      ok: true,
      command: 'estimate',
      estimate: estimateCost(input),
    };
  } catch (error) {
    if (error instanceof EstimateInputError) {
      throw new AutotelError({
        type: 'validation',
        code: AutotelErrorCodes.E_INVALID_INPUT,
        message: error.message,
        fix: `Pass ${flagFor(error.field)} with a value in ${error.expected}.`,
        expected: { [error.field]: error.expected },
      });
    }
    throw error;
  }
}
