/**
 * Error classification and retry logic for webhook providers
 *
 * Intelligently maps HTTP status codes to retriable vs non-retriable errors
 */

export type ProviderErrorCode =
  | 'VALIDATION'
  | 'CONFIG'
  | 'RATE_LIMITED'
  | 'PROVIDER'
  | 'NETWORK';

/**
 * Structured error for event subscriber failures
 *
 * Includes error code, retriability flag, and optional details from the provider
 */
export class SubscriberProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retriable: boolean;
  readonly details?: unknown;

  constructor(options: {
    message: string;
    code: ProviderErrorCode;
    retriable: boolean;
    details?: unknown;
    cause?: unknown;
  }) {
    super(options.message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SubscriberProviderError';
    this.code = options.code;
    this.retriable = options.retriable;
    this.details = options.details;
  }
}

export type MappedHttpError = { code: ProviderErrorCode; retriable: boolean };

/**
 * Map HTTP status codes to error classification
 *
 * - 400, 422: VALIDATION (not retriable)
 * - 401, 403, 404: CONFIG (not retriable)
 * - 429: RATE_LIMITED (retriable)
 * - 5xx: PROVIDER (retriable)
 * - 2xx-3xx: Success (not error)
 */
export function mapHttpStatus(status: number): MappedHttpError {
  switch (status) {
    case 400:
    case 422: {
      return { code: 'VALIDATION', retriable: false };
    }
    case 401:
    case 403:
    case 404: {
      return { code: 'CONFIG', retriable: false };
    }
    case 429: {
      return { code: 'RATE_LIMITED', retriable: true };
    }
    default: {
      return { code: 'PROVIDER', retriable: status >= 500 };
    }
  }
}

/**
 * Check if an error is retriable
 *
 * Returns the retriable flag from SubscriberProviderError, or true for unknown errors
 */
export function isProviderRetriable(error: unknown): boolean {
  if (error instanceof SubscriberProviderError) return error.retriable;
  return true;
}
