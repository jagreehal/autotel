import type { StructuredError } from './structured-error';
import type { UnknownRecord } from './values';
import { asNumber, asRecord, asString, readProperty } from './values';

export interface ParsedError {
  message: string;
  status: number;
  why?: string;
  fix?: string;
  link?: string;
  code?: string | number;
  details?: UnknownRecord;
  raw: unknown;
}

/** An HTTP-ish status, however the library that threw chose to spell it. */
function toStatus(value: unknown): number | undefined {
  const text = asString(value);
  return text === undefined
    ? asNumber(value)
    : (asNumber(Number(text)) ?? undefined);
}

function pickString(value: unknown): string | undefined {
  const text = asString(value);
  return text !== undefined && text.length > 0 ? text : undefined;
}

function pickCode(value: unknown): string | number | undefined {
  return asString(value) ?? asNumber(value);
}

/**
 * A plain object of extra fields. Only a plain one: an Error, a Response or a
 * class instance carries behaviour, and copying it onto a log line as details
 * would serialise something the thrower never meant to publish.
 */
function pickDetails(value: unknown): UnknownRecord | undefined {
  const record = asRecord(value);
  return record?.constructor === Object ? record : undefined;
}

export function parseError(error: unknown): ParsedError {
  if (error instanceof Error) {
    // SAFETY: StructuredError adds optional fields to Error, so reading a
    // plain Error through it finds them undefined - which is what the pick*
    // helpers below expect and answer `undefined` to.
    const structured = error as StructuredError;
    return {
      message: error.message || 'An error occurred',
      status: toStatus(structured.status) ?? 500,
      why: pickString(structured.why),
      fix: pickString(structured.fix),
      link: pickString(structured.link),
      code: pickCode(structured.code),
      details: pickDetails(structured.details),
      raw: error,
    };
  }

  const err = asRecord(error);
  if (err) {
    const data = asRecord(err.data);
    const nested = asRecord(readProperty(data, 'data'));
    const payload = nested ?? data;

    const message =
      pickString(data?.statusText) ||
      pickString(data?.statusMessage) ||
      pickString(data?.message) ||
      pickString(payload?.statusText) ||
      pickString(payload?.statusMessage) ||
      pickString(payload?.message) ||
      pickString(err.message) ||
      'An error occurred';

    const status =
      toStatus(payload?.status) ||
      toStatus(payload?.statusCode) ||
      toStatus(err.status) ||
      toStatus(err.statusCode) ||
      500;

    return {
      message,
      status,
      why: pickString(payload?.why) || pickString(err.why),
      fix: pickString(payload?.fix) || pickString(err.fix),
      link: pickString(payload?.link) || pickString(err.link),
      code: pickCode(payload?.code) || pickCode(err.code),
      details: pickDetails(payload?.details) || pickDetails(err.details),
      raw: error,
    };
  }

  return {
    message: String(error),
    status: 500,
    raw: error,
  };
}
