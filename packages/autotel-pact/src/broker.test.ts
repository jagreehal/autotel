import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  brokerConfigFromEnv,
  fetchBrokerVerifications,
  parseBrokerVerificationResult,
} from './broker.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('parseBrokerVerificationResult', () => {
  it('parses success and verifiedAt', () => {
    const r = parseBrokerVerificationResult('A', 'B', {
      success: true,
      verifiedAt: '2026-01-01T00:00:00Z',
    });
    expect(r).toEqual({
      consumer: 'A',
      provider: 'B',
      success: true,
      verifiedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('falls back to verified_at (snake_case) and createdAt', () => {
    expect(
      parseBrokerVerificationResult('A', 'B', { success: true, verified_at: '2026-01-02T00:00:00Z' }),
    ).toMatchObject({ verifiedAt: '2026-01-02T00:00:00Z' });
    expect(
      parseBrokerVerificationResult('A', 'B', { success: true, createdAt: '2026-01-03T00:00:00Z' }),
    ).toMatchObject({ verifiedAt: '2026-01-03T00:00:00Z' });
  });

  it('infers success from result: "success" when success field missing', () => {
    expect(
      parseBrokerVerificationResult('A', 'B', { result: 'success' }),
    ).toMatchObject({ success: true });
  });

  it('returns null for non-object input', () => {
    expect(parseBrokerVerificationResult('A', 'B', null)).toBeNull();
    expect(parseBrokerVerificationResult('A', 'B', 'string')).toBeNull();
  });
});

describe('fetchBrokerVerifications', () => {
  it('fetches latest verification per pair with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, verifiedAt: '2026-06-01T00:00:00Z' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await fetchBrokerVerifications(
      { baseUrl: 'https://broker.example', token: 'tok' },
      [{ consumer: 'A', provider: 'B' }],
    );

    expect(results[0]).toMatchObject({ consumer: 'A', provider: 'B', success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://broker.example/pacts/provider/B/consumer/A/latest/verification-results',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
  });

  it('uses basic auth when username + password supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchBrokerVerifications(
      { baseUrl: 'https://b.example', username: 'u', password: 'p' },
      [{ consumer: 'A', provider: 'B' }],
    );

    const expectedAuth = `Basic ${Buffer.from('u:p').toString('base64')}`;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expectedAuth }),
      }),
    );
  });

  it('records error and success:false on non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const [result] = await fetchBrokerVerifications(
      { baseUrl: 'https://b.example' },
      [{ consumer: 'A', provider: 'B' }],
    );
    expect(result).toMatchObject({
      consumer: 'A',
      provider: 'B',
      success: false,
      error: 'HTTP 404 Not Found',
    });
  });

  it('records error and success:false on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ENOTFOUND broker.example'));
    vi.stubGlobal('fetch', fetchMock);

    const [result] = await fetchBrokerVerifications(
      { baseUrl: 'https://b.example' },
      [{ consumer: 'A', provider: 'B' }],
    );
    expect(result).toMatchObject({
      consumer: 'A',
      provider: 'B',
      success: false,
      error: 'ENOTFOUND broker.example',
    });
  });

  it('handles multiple pairs and trims trailing slash on base url', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      calls.push(url);
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await fetchBrokerVerifications(
      { baseUrl: 'https://b.example/' },
      [
        { consumer: 'A', provider: 'B' },
        { consumer: 'C', provider: 'D' },
      ],
    );

    expect(results).toHaveLength(2);
    expect(calls[0]).toBe(
      'https://b.example/pacts/provider/B/consumer/A/latest/verification-results',
    );
    expect(calls[1]).toBe(
      'https://b.example/pacts/provider/D/consumer/C/latest/verification-results',
    );
  });
});

describe('brokerConfigFromEnv', () => {
  it('returns undefined when PACT_BROKER_BASE_URL is unset', () => {
    vi.stubEnv('PACT_BROKER_BASE_URL', '');
    expect(brokerConfigFromEnv()).toBeUndefined();
  });

  it('reads baseUrl, token, and basic auth from env', () => {
    vi.stubEnv('PACT_BROKER_BASE_URL', 'https://b.example');
    vi.stubEnv('PACT_BROKER_TOKEN', 'tok');
    vi.stubEnv('PACT_BROKER_USERNAME', 'u');
    vi.stubEnv('PACT_BROKER_PASSWORD', 'p');
    expect(brokerConfigFromEnv()).toEqual({
      baseUrl: 'https://b.example',
      token: 'tok',
      username: 'u',
      password: 'p',
    });
  });
});
