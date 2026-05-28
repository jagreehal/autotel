import type { BrokerVerification } from './types.js';

export interface BrokerConfig {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
}

export interface ConsumerProviderPair {
  consumer: string;
  provider: string;
}

function authHeaders(config: BrokerConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  } else if (config.username && config.password) {
    const encoded = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    headers.Authorization = `Basic ${encoded}`;
  }
  return headers;
}

function trimBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Parse Pact Broker latest verification result payload.
 */
export function parseBrokerVerificationResult(
  consumer: string,
  provider: string,
  json: unknown,
): BrokerVerification | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as Record<string, unknown>;
  const success =
    body.success === true ||
    (body.success === undefined && body.result === 'success');
  const verifiedAt =
    typeof body.verifiedAt === 'string'
      ? body.verifiedAt
      : typeof body.verified_at === 'string'
        ? body.verified_at
        : typeof body.createdAt === 'string'
          ? body.createdAt
          : undefined;

  return {
    consumer,
    provider,
    success: !!success,
    verifiedAt,
  };
}

/**
 * Fetch latest verification results for each consumer–provider pair.
 */
export async function fetchBrokerVerifications(
  config: BrokerConfig,
  pairs: ConsumerProviderPair[],
): Promise<BrokerVerification[]> {
  const base = trimBaseUrl(config.baseUrl);
  const headers = authHeaders(config);
  const results: BrokerVerification[] = [];

  for (const { consumer, provider } of pairs) {
    const url = `${base}/pacts/provider/${encodeURIComponent(provider)}/consumer/${encodeURIComponent(consumer)}/latest/verification-results`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        results.push({
          consumer,
          provider,
          success: false,
          error: `HTTP ${res.status} ${res.statusText}`.trim(),
        });
        continue;
      }
      const json: unknown = await res.json();
      const parsed = parseBrokerVerificationResult(consumer, provider, json);
      results.push(
        parsed ?? {
          consumer,
          provider,
          success: false,
          error: 'Unparseable broker response',
        },
      );
    } catch (error) {
      results.push({
        consumer,
        provider,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function brokerConfigFromEnv(): BrokerConfig | undefined {
  const baseUrl = process.env.PACT_BROKER_BASE_URL;
  if (!baseUrl) return undefined;
  return {
    baseUrl,
    token: process.env.PACT_BROKER_TOKEN,
    username: process.env.PACT_BROKER_USERNAME,
    password: process.env.PACT_BROKER_PASSWORD,
  };
}
