/**
 * Tests for new trace helper utilities
 */

import { describe, it, expect } from 'vitest';
import { createDeterministicTraceId, flattenMetadata } from './trace-helpers';

describe('createDeterministicTraceId', () => {
  it('should generate consistent trace IDs from the same seed', async () => {
    const seed = 'request-123';
    const traceId1 = await createDeterministicTraceId(seed);
    const traceId2 = await createDeterministicTraceId(seed);

    expect(traceId1).toBe(traceId2);
  });

  it('should generate different trace IDs from different seeds', async () => {
    const traceId1 = await createDeterministicTraceId('seed-1');
    const traceId2 = await createDeterministicTraceId('seed-2');

    expect(traceId1).not.toBe(traceId2);
  });

  it('should generate valid 32-character hex trace IDs', async () => {
    const traceId = await createDeterministicTraceId('test-seed');

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(traceId).toHaveLength(32);
  });

  it('should handle empty string seed', async () => {
    const traceId = await createDeterministicTraceId('');

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should handle long seed strings', async () => {
    const longSeed = 'a'.repeat(1000);
    const traceId = await createDeterministicTraceId(longSeed);

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should handle special characters in seed', async () => {
    const specialSeed = 'test!@#$%^&*()_+-=[]{}|;:,.<>?';
    const traceId = await createDeterministicTraceId(specialSeed);

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should handle unicode in seed', async () => {
    const unicodeSeed = 'test-中文-🚀';
    const traceId = await createDeterministicTraceId(unicodeSeed);

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('flattenMetadata', () => {
  it('should flatten simple object with default prefix', () => {
    const metadata = {
      userId: '123',
      email: 'user@example.com',
      plan: 'premium',
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.userId': '123',
      'metadata.email': 'user@example.com',
      'metadata.plan': 'premium',
    });
  });

  it('should use custom prefix', () => {
    const metadata = {
      userId: '123',
      email: 'user@example.com',
    };

    const flattened = flattenMetadata(metadata, 'user');

    expect(flattened).toEqual({
      'user.userId': '123',
      'user.email': 'user@example.com',
    });
  });

  it('should recursively flatten nested objects', () => {
    const metadata = {
      count: 42,
      active: true,
      config: { timeout: 5000, retries: 3 },
      tags: ['a', 'b', 'c'],
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.count': '42',
      'metadata.active': 'true',
      'metadata.config.timeout': '5000',
      'metadata.config.retries': '3',
      'metadata.tags': '["a","b","c"]',
    });
  });

  it('should match documentation example - order metadata', () => {
    const metadata = {
      user: { id: 'user-123', tier: 'premium' },
      payment: { method: 'card', processor: 'stripe' },
      items: 5,
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.user.id': 'user-123',
      'metadata.user.tier': 'premium',
      'metadata.payment.method': 'card',
      'metadata.payment.processor': 'stripe',
      'metadata.items': '5',
    });
  });

  it('should handle deeply nested objects', () => {
    const metadata = {
      level1: {
        level2: {
          level3: {
            deepValue: 'found',
          },
        },
      },
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.level1.level2.level3.deepValue': 'found',
    });
  });

  it('should skip null values', () => {
    const metadata = {
      userId: '123',
      email: null,
      plan: 'premium',
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.userId': '123',
      'metadata.plan': 'premium',
    });
  });

  it('should skip undefined values', () => {
    const metadata = {
      userId: '123',
      email: undefined,
      plan: 'premium',
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.userId': '123',
      'metadata.plan': 'premium',
    });
  });

  it('should handle empty object', () => {
    const flattened = flattenMetadata({});

    expect(flattened).toEqual({});
  });

  it('should handle circular references gracefully', () => {
    const metadata: { userId: string; self?: unknown } = {
      userId: '123',
    };
    metadata.self = metadata;

    const flattened = flattenMetadata(metadata);

    // Processes properties until it encounters the cycle
    expect(flattened).toEqual({
      'metadata.userId': '123',
      'metadata.self.userId': '123',
      'metadata.self.self': '<circular-reference>',
    });
  });

  it('should preserve string values as-is without JSON serialization', () => {
    const metadata = {
      name: 'John',
      description: 'A developer',
    };

    const flattened = flattenMetadata(metadata);

    // Strings should not have quotes added
    expect(flattened).toEqual({
      'metadata.name': 'John',
      'metadata.description': 'A developer',
    });
  });

  it('should handle Date objects', () => {
    const date = new Date('2024-01-15T12:00:00.000Z');
    const metadata = {
      timestamp: date,
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened['metadata.timestamp']).toBe(JSON.stringify(date));
  });

  it('should handle nested objects', () => {
    const metadata = {
      user: {
        id: '123',
        settings: {
          theme: 'dark',
          notifications: true,
        },
      },
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.user.id': '123',
      'metadata.user.settings.theme': 'dark',
      'metadata.user.settings.notifications': 'true',
    });
  });

  it('should handle arrays', () => {
    const metadata = {
      tags: ['typescript', 'nodejs', 'observability'],
      numbers: [1, 2, 3],
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.tags': '["typescript","nodejs","observability"]',
      'metadata.numbers': '[1,2,3]',
    });
  });

  it('should handle mixed types', () => {
    const metadata = {
      string: 'value',
      number: 123,
      boolean: false,
      nullValue: null,
      undefinedValue: undefined,
      object: { nested: 'data' },
      array: [1, 2, 3],
    };

    const flattened = flattenMetadata(metadata);

    expect(flattened).toEqual({
      'metadata.string': 'value',
      'metadata.number': '123',
      'metadata.boolean': 'false',
      'metadata.object.nested': 'data',
      'metadata.array': '[1,2,3]',
    });
  });
});
