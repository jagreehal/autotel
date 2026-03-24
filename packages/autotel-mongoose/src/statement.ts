import { createStringRedactor, type StringRedactor } from 'autotel';
import type { SerializerPayload, InstrumentMongooseConfig } from './types';

/**
 * Default serializer — JSON.stringify of the payload.
 */
export function defaultSerializer(
  _operation: string,
  payload: SerializerPayload,
): string {
  return JSON.stringify(payload);
}

export type StatementCaptureFn = (
  operation: string,
  payload: SerializerPayload,
) => string | undefined;

/**
 * Composes the serializer and redactor into a single capture function.
 * Returns undefined if statement capture is disabled.
 */
export function createStatementCapture(config: {
  dbStatementSerializer: InstrumentMongooseConfig['dbStatementSerializer'];
  statementRedactor: InstrumentMongooseConfig['statementRedactor'];
}): StatementCaptureFn {
  // Statement capture disabled
  if (config.dbStatementSerializer === false) {
    return (): undefined => {
      return;
    };
  }

  const serializer =
    typeof config.dbStatementSerializer === 'function'
      ? config.dbStatementSerializer
      : defaultSerializer;

  // Build redactor (or no-op)
  let redact: StringRedactor | undefined;
  if (
    config.statementRedactor !== false &&
    config.statementRedactor !== undefined
  ) {
    redact = createStringRedactor(config.statementRedactor);
  }

  return (
    operation: string,
    payload: SerializerPayload,
  ): string | undefined => {
    const raw = serializer(operation, payload);
    if (raw === undefined) {
      return undefined;
    }
    return redact ? redact(raw) : raw;
  };
}
