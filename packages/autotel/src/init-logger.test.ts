import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './logger';
import { silentLogger, wrapLogger } from './init-logger';

function loggerSpies() {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    logger: { debug, info, warn, error } as Logger,
    debug,
    info,
    warn,
    error,
  };
}

describe('init logger resolution', () => {
  it('uses the shared silent logger when diagnostics are disabled', () => {
    const { logger } = loggerSpies();
    expect(wrapLogger(logger, true, 'debug')).toBe(silentLogger);
  });

  it('drops messages below the configured level and preserves arguments', () => {
    const { logger, debug, info, warn, error } = loggerSpies();
    const wrapped = wrapLogger(logger, false, 'warn');

    wrapped.debug('debug');
    wrapped.info('info');
    wrapped.warn({ requestId: 'req-1' }, 'warn');
    wrapped.error('error');

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith({ requestId: 'req-1' }, 'warn');
    expect(error).toHaveBeenCalledWith('error');
  });

  it('keeps `this` bound for method-based loggers like pino', () => {
    const calls: unknown[] = [];
    const logger = {
      prefix: 'p',
      debug() {},
      info(this: { prefix: string }, msg: string) {
        calls.push(`${this.prefix}:${msg}`);
      },
      warn() {},
      error() {},
    } as unknown as Logger;

    wrapLogger(logger, false, 'debug').info('hi');

    expect(calls).toEqual(['p:hi']);
  });
});
