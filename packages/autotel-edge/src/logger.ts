/**
 * Zero-dependency logger for edge runtimes with dynamic log level control
 * Entry point: autotel-edge/logger
 */

export {
  createEdgeLogger,
  getEdgeTraceContext,
  runWithLogLevel,
  getActiveLogLevel,
  type EdgeLogger,
  type EdgeLoggerOptions,
  type LogLevel,
  type LogEvent,
  type WriteFn,
  type TimeFn,
} from './api/logger';

export {
  createRedactor,
  REDACT_PRESETS,
  type Censor,
  type RedactorOptions,
  type RedactorConfig,
  type RedactorPreset,
} from './api/redact';
