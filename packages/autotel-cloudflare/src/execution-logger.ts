import {
  type ExecutionLogger,
  type ExecutionLoggerOptions,
  type ExecutionLogSnapshot,
  getExecutionLogger,
  type TraceContext,
} from 'autotel-edge';

export type {
  ExecutionLogger,
  ExecutionLoggerOptions,
  ExecutionLogSnapshot,
};

export function getRequestLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  return getExecutionLogger(ctx, options);
}

export function getQueueLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  return getExecutionLogger(ctx, options);
}

export function getWorkflowLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  return getExecutionLogger(ctx, options);
}

export function getActorLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  return getExecutionLogger(ctx, options);
}
