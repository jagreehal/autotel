import { describe, expect, it } from 'vitest';
import { AutotelError, exitCodeForError } from '../lib/errors';
import { runEstimate } from './estimate';

describe('runEstimate', () => {
  it('returns a success envelope carrying the estimate', () => {
    const envelope = runEstimate({
      requestsPerMonth: 10_000_000,
      logLinesPerRequest: 4,
      perGb: 0.1,
    });

    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('estimate');
    expect(envelope.estimate.currency).toBe('USD');
    expect(envelope.estimate.before.cost).toBeGreaterThan(
      envelope.estimate.after.cost,
    );
  });

  it('fails as caller-fixable when the rate is missing', () => {
    // Exit 2 is the agent's signal to fix its own arguments and retry, rather
    // than treat the run as a broken tool.
    let thrown: unknown;
    try {
      runEstimate({ requestsPerMonth: 10_000_000 } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AutotelError);
    expect(exitCodeForError(thrown as AutotelError)).toBe(2);
    expect((thrown as AutotelError).toEnvelope('estimate').error.code).toBe(
      'AUTOTEL_E_INVALID_INPUT',
    );
  });
});
