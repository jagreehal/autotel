import { createStringRedactor, type StringRedactor } from 'autotel';
import type {
  SerializerPayload,
  InstrumentMongooseConfig,
  ParameterCaptureConfig,
  CustomMethodType,
} from './types';

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

const DEFAULT_PARAMETER_MAX_LENGTH = 2048;

/**
 * Default serializer for custom-method arguments. Safely JSON-encodes the
 * argument list, resolving Mongoose documents via `toObject()` and handling
 * BigInt, functions, and circular references without throwing.
 */
export function defaultParameterSerializer(
  args: readonly unknown[],
): string | undefined {
  if (args.length === 0) {
    return undefined;
  }

  const seen = new WeakSet<object>();
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'function') {
      return '[Function]';
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };

  // Resolve Mongoose documents (and anything else exposing toObject) up front
  // so we serialize plain data rather than internal document state.
  const normalized = args.map((arg) => {
    if (
      arg !== null &&
      typeof arg === 'object' &&
      typeof (arg as { toObject?: unknown }).toObject === 'function'
    ) {
      try {
        return (arg as { toObject: () => unknown }).toObject();
      } catch {
        return arg;
      }
    }
    return arg;
  });

  try {
    const json = JSON.stringify(normalized, replacer);
    return json === undefined ? undefined : json;
  } catch {
    return undefined;
  }
}

export type ParameterCaptureFn = (
  args: readonly unknown[],
  context: { methodName: string; methodType: CustomMethodType },
) => string | undefined;

/**
 * Composes a parameter serializer + redactor + length cap into a single
 * capture function for custom-method arguments. The redactor defaults to the
 * instrumentation's `statementRedactor` so parameters get the same PII
 * protection as `db.query.text`.
 */
export function createParameterCapture(config: {
  parameterConfig: ParameterCaptureConfig | undefined;
  statementRedactor: InstrumentMongooseConfig['statementRedactor'];
}): ParameterCaptureFn {
  const { parameterConfig } = config;
  const maxLength = parameterConfig?.maxLength ?? DEFAULT_PARAMETER_MAX_LENGTH;
  const serialize = parameterConfig?.serializer ?? defaultParameterSerializer;

  // Parameter redactor: explicit config wins, otherwise inherit the statement
  // redactor. `false` (on either) disables redaction.
  const redactorSetting =
    parameterConfig?.redactor === undefined
      ? config.statementRedactor
      : parameterConfig.redactor;

  let redact: StringRedactor | undefined;
  if (redactorSetting !== false && redactorSetting !== undefined) {
    redact = createStringRedactor(redactorSetting);
  }

  return (args, context): string | undefined => {
    const raw = serialize(args, context);
    if (raw === undefined) {
      return undefined;
    }
    const redacted = redact ? redact(raw) : raw;
    return redacted.length > maxLength
      ? `${redacted.slice(0, maxLength)}…[truncated]`
      : redacted;
  };
}
