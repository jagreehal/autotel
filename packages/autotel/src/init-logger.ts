import type { Logger } from './logger';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

/** Silent logger used until and unless the application opts into diagnostics. */
export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Apply the resolved silence and minimum-level settings to a logger. */
export function wrapLogger(
  base: Logger,
  silent: boolean,
  minLevel: LogLevel,
): Logger {
  if (silent) return silentLogger;
  const threshold = LOG_LEVELS[minLevel];
  const wrap = (fn: Logger['info'], level: LogLevel): Logger['info'] => {
    if (LOG_LEVELS[level] < threshold) {
      return (() => {}) as Logger['info'];
    }
    return ((...args: Parameters<Logger['info']>) =>
      fn(...args)) as Logger['info'];
  };
  return {
    debug: wrap(base.debug, 'debug'),
    info: wrap(base.info, 'info'),
    warn: wrap(base.warn, 'warn'),
    error: wrap(base.error, 'error'),
  };
}
