/**
 * Shared JSON webhook delivery: timeout-bounded POST with classified
 * errors and exponential-backoff retries. Used by `WebhookSubscriber`
 * and `SecuritySubscriber` so delivery semantics stay identical.
 */

import type { createHttpClient } from './http-client';
import {
  mapHttpStatus,
  SubscriberProviderError,
  isProviderRetriable,
} from './retry-classification';

export type HttpClient = ReturnType<typeof createHttpClient>;

export type JsonDeliveryOptions = {
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  /** Attempts including the first. Default 3. */
  maxRetries?: number;
  /** Base backoff delay; doubles per attempt. Default 1000. */
  retryDelayMs?: number;
  /** Prefix for error messages, e.g. `Webhook` or `Security webhook`. */
  label?: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST `payload` as JSON, retrying retriable failures with exponential
 * backoff. Throws a classified `SubscriberProviderError` once retries are
 * exhausted — callers rely on the `EventSubscriber` base class to route
 * that through `handleError`.
 */
export async function postJsonWithRetry(
  client: HttpClient,
  url: string,
  payload: unknown,
  options: JsonDeliveryOptions = {},
): Promise<void> {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const method = options.method ?? 'POST';
  const label = options.label ?? 'Webhook';
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await client.request<unknown, unknown>(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) return;

    if (response.kind === 'network') {
      lastError = new SubscriberProviderError({
        message: response.timedOut
          ? `${label} request timed out`
          : `${label} network request failed`,
        code: 'NETWORK',
        retriable: true,
        details: response.cause,
        cause: response.cause,
      });
    } else {
      const mapped = mapHttpStatus(response.status);
      lastError = new SubscriberProviderError({
        message: `${label} returned ${response.status}: ${response.statusText}`,
        code: mapped.code,
        retriable: mapped.retriable,
        details: response.body,
      });
    }

    const canRetry = isProviderRetriable(lastError) && attempt < maxRetries;
    if (!canRetry) break;

    await delay(retryDelayMs * 2 ** (attempt - 1));
  }

  throw lastError ?? new Error(`${label} send failed`);
}
