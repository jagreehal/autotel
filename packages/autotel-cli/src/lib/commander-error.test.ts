import { describe, expect, it, vi, afterEach } from 'vitest';
import { commanderErrorToAutotel } from './commander-error';
import { AutotelError } from './errors';

describe('commanderErrorToAutotel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for non-commander errors', () => {
    expect(commanderErrorToAutotel(new Error('plain'))).toBeNull();
    expect(commanderErrorToAutotel(null)).toBeNull();
    expect(commanderErrorToAutotel('string')).toBeNull();
    expect(commanderErrorToAutotel({ code: 'something' })).toBeNull();
    expect(commanderErrorToAutotel({ code: 42 })).toBeNull();
  });

  it('maps missing required option to a validation AutotelError', () => {
    const ce = {
      code: 'commander.missingMandatoryOptionValue',
      message: "error: required option '--service <name>' not specified",
      exitCode: 1,
    };
    const err = commanderErrorToAutotel(ce);
    expect(err).toBeInstanceOf(AutotelError);
    expect(err!.type).toBe('validation');
    expect(err!.code).toBe('AUTOTEL_E_INVALID_FLAG');
    expect(err!.message).toBe(ce.message);
    expect(err!.expected).toEqual({ commanderCode: ce.code });
  });

  it('maps unknown command to a validation AutotelError', () => {
    const err = commanderErrorToAutotel({
      code: 'commander.unknownCommand',
      message: "error: unknown command 'whatever'",
    });
    expect(err).toBeInstanceOf(AutotelError);
    expect(err!.type).toBe('validation');
    expect(err!.expected).toEqual({ commanderCode: 'commander.unknownCommand' });
  });

  it('exits 0 when commander signals help was printed', () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => 0) as never);
    commanderErrorToAutotel({
      code: 'commander.helpDisplayed',
      message: '(help)',
      exitCode: 0,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits cleanly when commander signals version was printed', () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => 0) as never);
    commanderErrorToAutotel({
      code: 'commander.version',
      message: '0.0.0',
      exitCode: 0,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
