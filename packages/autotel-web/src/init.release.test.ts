/**
 * Which release a span came from is what a backend matches source maps and
 * groups regressions by, and which environment is how errors get filtered.
 * Without both on the resource, every browser error looks like one release in
 * no environment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init, resetForTesting } from './init';
import { flushSpans } from './span-exporter';

const COLLECTOR = 'http://localhost:4848';
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetForTesting();
  mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('window', {
    fetch: mockFetch,
    location: {
      origin: 'http://localhost:3000',
      href: 'http://localhost:3000/',
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  resetForTesting();
  vi.unstubAllGlobals();
});

async function exportedResource(): Promise<Map<string, string>> {
  // SAFETY: beforeEach stubs a window carrying a fetch, which init() wraps.
  const page = globalThis.window as { fetch: typeof fetch };
  await page.fetch('/api/orders');
  flushSpans();
  const call = mockFetch.mock.calls.find(
    (c) => String(c[0]) === `${COLLECTOR}/v1/traces`,
  );
  // SAFETY: the exporter posts JSON in OTLP's shape.
  const payload = JSON.parse(String(call?.[1]?.body)) as {
    resourceSpans: Array<{
      resource: {
        attributes: Array<{ key: string; value: { stringValue: string } }>;
      };
    }>;
  };
  return new Map(
    payload.resourceSpans[0]!.resource.attributes.map((a) => [
      a.key,
      a.value.stringValue,
    ]),
  );
}

describe('release and environment', () => {
  it('ride on the resource of every export', async () => {
    init({
      service: 'web',
      endpoint: COLLECTOR,
      version: '1.4.2',
      environment: 'production',
    });
    expect(Object.fromEntries(await exportedResource())).toEqual({
      'service.name': 'web',
      'service.version': '1.4.2',
      'deployment.environment.name': 'production',
    });
  });

  it('are left off when not configured', async () => {
    init({ service: 'web', endpoint: COLLECTOR });
    expect(Object.fromEntries(await exportedResource())).toEqual({
      'service.name': 'web',
    });
  });
});
