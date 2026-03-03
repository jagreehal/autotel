import type { StructuredError } from './structured-error';

export interface ParsedError {
  message: string;
  status: number;
  why?: string;
  fix?: string;
  link?: string;
  code?: string | number;
  details?: Record<string, unknown>;
  raw: unknown;
}

type ErrorLike = {
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  data?: unknown;
  code?: unknown;
  why?: unknown;
  fix?: unknown;
  link?: unknown;
  details?: unknown;
};

function toStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickCode(value: unknown): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

function pickDetails(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && value.constructor === Object) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function parseError(error: unknown): ParsedError {
  if (error instanceof Error) {
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

  if (error && typeof error === 'object') {
    const err = error as ErrorLike;
    const data =
      err.data && typeof err.data === 'object'
        ? (err.data as Record<string, unknown>)
        : undefined;
    const nested =
      data?.data && typeof data.data === 'object'
        ? (data.data as Record<string, unknown>)
        : undefined;
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
