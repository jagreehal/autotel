// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cachedRemoteConfig,
  refreshRemoteConfig,
  resetRemoteConfigForTesting,
} from './remote-config';

const URL = 'https://cdn.example.com/autotel.json';

function ok(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

beforeEach(() => {
  resetRemoteConfigForTesting();
  localStorage.clear();
});

describe('remote config', () => {
  it('has nothing to offer before anything is fetched', () => {
    expect(cachedRemoteConfig()).toBeUndefined();
  });

  it('fetches and applies a config', async () => {
    const config = await refreshRemoteConfig(URL, {
      fetchImpl: ok({ sampleRate: 0.25, captureDeadClicks: false }),
    });
    expect(config).toEqual({ sampleRate: 0.25, captureDeadClicks: false });
    expect(cachedRemoteConfig()).toEqual(config);
  });

  it('survives a reload without waiting for the network', async () => {
    await refreshRemoteConfig(URL, { fetchImpl: ok({ sampleRate: 0.5 }) });
    resetRemoteConfigForTesting();
    // A fresh page load reads the last good config synchronously, so the first
    // spans of the visit are not sampled under a stale default.
    expect(cachedRemoteConfig()).toEqual({ sampleRate: 0.5 });
  });

  it('keeps the last good config when the network fails', async () => {
    await refreshRemoteConfig(URL, { fetchImpl: ok({ sampleRate: 0.5 }) });
    const result = await refreshRemoteConfig(URL, {
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
    });
    expect(result).toEqual({ sampleRate: 0.5 });
    expect(cachedRemoteConfig()).toEqual({ sampleRate: 0.5 });
  });

  it('keeps the last good config when the server errors', async () => {
    await refreshRemoteConfig(URL, { fetchImpl: ok({ sampleRate: 0.5 }) });
    await refreshRemoteConfig(URL, {
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    });
    expect(cachedRemoteConfig()).toEqual({ sampleRate: 0.5 });
  });

  it('ignores a payload that is not an object', async () => {
    expect(
      await refreshRemoteConfig(URL, { fetchImpl: ok('nope') }),
    ).toBeUndefined();
  });

  it('drops fields it does not recognise rather than trusting them', async () => {
    // The file is fetched from a URL; whatever else is in it is not config.
    const config = await refreshRemoteConfig(URL, {
      fetchImpl: ok({ sampleRate: 0.5, evil: 'rm -rf', __proto__: { x: 1 } }),
    });
    expect(config).toEqual({ sampleRate: 0.5 });
  });

  it('rejects a sample rate outside 0..1', async () => {
    expect(
      await refreshRemoteConfig(URL, { fetchImpl: ok({ sampleRate: 42 }) }),
    ).toBeUndefined();
  });

  it('accepts error suppression rules in the shape the package already uses', async () => {
    const rule = {
      key: 'value',
      operator: 'contains',
      value: 'ResizeObserver loop limit exceeded',
    };
    const config = await refreshRemoteConfig(URL, {
      fetchImpl: ok({ errorSuppression: [rule] }),
    });
    expect(config?.errorSuppression).toEqual([rule]);
  });

  it('drops a suppression rule that would not match anything', async () => {
    // A rule with an unknown key or operator silently suppresses nothing, which
    // reads as "the errors stopped" — worse than rejecting the file.
    const config = await refreshRemoteConfig(URL, {
      fetchImpl: ok({
        errorSuppression: [
          { key: 'nonsense', operator: 'exact', value: 'x' },
          { key: 'type', operator: 'sideways', value: 'x' },
          { key: 'type', operator: 'exact' },
        ],
      }),
    });
    expect(config?.errorSuppression).toBeUndefined();
  });

  it('never throws when storage is unavailable', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await expect(
      refreshRemoteConfig(URL, { fetchImpl: ok({ sampleRate: 0.5 }) }),
    ).resolves.toBeDefined();
    setItem.mockRestore();
  });
});
