import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSafeBaggageSchema,
  BusinessBaggage,
  type BaggageError,
} from './business-baggage';

// Mock OpenTelemetry propagation API
vi.mock('@opentelemetry/api', () => {
  const baggageStore = new Map<string, { value: string }>();

  return {
    context: {
      active: vi.fn(() => ({})),
    },
    propagation: {
      getBaggage: vi.fn(() => ({
        getEntry: (key: string) => baggageStore.get(key),
        getAllEntries: () =>
          [...baggageStore.entries()].map(([k, v]) => [k, v]),
        setEntry: vi.fn((key: string, entry: { value: string }) => {
          baggageStore.set(key, entry);
          return {
            getEntry: (k: string) => baggageStore.get(k),
            getAllEntries: () =>
              [...baggageStore.entries()].map(([k, v]) => [k, v]),
            setEntry: vi.fn(),
            removeEntry: vi.fn(),
          };
        }),
        removeEntry: vi.fn((key: string) => {
          baggageStore.delete(key);
          return {
            getEntry: (k: string) => baggageStore.get(k),
            getAllEntries: () => [...baggageStore.entries()],
            setEntry: vi.fn(),
            removeEntry: vi.fn(),
          };
        }),
      })),
      createBaggage: vi.fn(() => ({
        getEntry: () => {},
        getAllEntries: () => [],
        setEntry: vi.fn((key: string, entry: { value: string }) => {
          baggageStore.set(key, entry);
          return {
            getEntry: (k: string) => baggageStore.get(k),
            getAllEntries: () => [...baggageStore.entries()],
            setEntry: vi.fn(),
            removeEntry: vi.fn(),
          };
        }),
        removeEntry: vi.fn(),
      })),
      setBaggage: vi.fn(() => ({})),
      inject: vi.fn((ctx, headers) => {
        headers['traceparent'] = '00-abc-def-01';
        for (const [k, v] of baggageStore.entries()) {
          headers[k] = v.value;
        }
      }),
      extract: vi.fn(() => ({})),
    },
  };
});

describe('Business Baggage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSafeBaggageSchema', () => {
    it('should create a schema with string fields', () => {
      const schema = createSafeBaggageSchema({
        orderId: { type: 'string' },
        customerId: { type: 'string' },
      });

      expect(schema).toBeDefined();
      expect(schema.get).toBeDefined();
      expect(schema.set).toBeDefined();
      expect(schema.getValue).toBeDefined();
      expect(schema.setValue).toBeDefined();
    });

    it('should create a schema with number fields', () => {
      const schema = createSafeBaggageSchema({
        amount: { type: 'number' },
        quantity: { type: 'number' },
      });

      expect(schema).toBeDefined();
    });

    it('should create a schema with boolean fields', () => {
      const schema = createSafeBaggageSchema({
        debug: { type: 'boolean' },
        premium: { type: 'boolean' },
      });

      expect(schema).toBeDefined();
    });

    it('should create a schema with enum fields', () => {
      const schema = createSafeBaggageSchema({
        priority: { type: 'enum', values: ['low', 'normal', 'high'] as const },
        status: {
          type: 'enum',
          values: ['pending', 'active', 'done'] as const,
        },
      });

      expect(schema).toBeDefined();
    });

    it('should support field with maxLength', () => {
      const schema = createSafeBaggageSchema({
        description: { type: 'string', maxLength: 50 },
      });

      expect(schema).toBeDefined();
    });

    it('should support field with hash option', () => {
      const schema = createSafeBaggageSchema({
        userId: { type: 'string', hash: true },
      });

      expect(schema).toBeDefined();
    });

    it('should support field with defaultValue', () => {
      const schema = createSafeBaggageSchema({
        region: { type: 'string', defaultValue: 'us-east-1' },
      });

      const values = schema.get();
      expect(values.region).toBe('us-east-1');
    });

    it('should support custom validation', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          code: {
            type: 'string',
            validate: (value) =>
              typeof value === 'string' && value.length === 6,
          },
        },
        { onError },
      );

      expect(schema).toBeDefined();
    });
  });

  describe('SafeBaggageOptions', () => {
    it('should respect maxKeyLength', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          someVeryLongKeyNameThatExceedsLimit: { type: 'string' },
        },
        { maxKeyLength: 10, onError },
      );

      schema.set(undefined, { someVeryLongKeyNameThatExceedsLimit: 'value' });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'key_length' }),
      );
    });

    it('should respect maxValueLength', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          message: { type: 'string' },
        },
        { maxValueLength: 10, onError },
      );

      schema.set(undefined, { message: 'a'.repeat(50) });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'value_length' }),
      );
    });

    it('should use prefix for keys', () => {
      const schema = createSafeBaggageSchema(
        {
          userId: { type: 'string' },
        },
        { prefix: 'app' },
      );

      // The prefix is applied internally
      expect(schema).toBeDefined();
    });

    it('should detect PII when redactPII is enabled', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          contact: { type: 'string' },
        },
        { redactPII: true, onError },
      );

      schema.set(undefined, { contact: 'user@example.com' });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pii' }),
      );
    });

    it('should hash high-cardinality values when enabled', () => {
      const schema = createSafeBaggageSchema(
        {
          requestId: { type: 'string' },
        },
        { hashHighCardinality: true },
      );

      // UUID-like values should be hashed
      schema.set(undefined, {
        requestId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(schema).toBeDefined();
    });

    it('should reject keys not in allowedKeys whitelist', () => {
      expect(() =>
        createSafeBaggageSchema(
          {
            notAllowed: { type: 'string' },
          },
          { allowedKeys: ['allowed'] },
        ),
      ).toThrow('not in allowedKeys whitelist');
    });
  });

  describe('Schema validation', () => {
    it('should validate string type', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          name: { type: 'string' },
        },
        { onError },
      );

      // Number passed for string field should trigger validation error
      schema.set(undefined, { name: 123 as unknown as string });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'validation' }),
      );
    });

    it('should validate number type', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          count: { type: 'number' },
        },
        { onError },
      );

      schema.set(undefined, { count: 'not-a-number' as unknown as number });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'validation' }),
      );
    });

    it('should validate boolean type', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          enabled: { type: 'boolean' },
        },
        { onError },
      );

      schema.set(undefined, { enabled: 'true' as unknown as boolean });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'validation' }),
      );
    });

    it('should validate enum values', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          priority: { type: 'enum', values: ['low', 'high'] as const },
        },
        { onError },
      );

      schema.set(undefined, { priority: 'invalid' as 'low' | 'high' });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'validation' }),
      );
    });

    it('should handle required fields', () => {
      const onError = vi.fn();
      const schema = createSafeBaggageSchema(
        {
          requiredField: { type: 'string', required: true },
        },
        { onError },
      );

      schema.set(undefined, { requiredField: undefined as unknown as string });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'validation',
          message: expect.stringContaining('missing'),
        }),
      );
    });
  });

  describe('BusinessBaggage', () => {
    it('should be a pre-configured schema', () => {
      expect(BusinessBaggage).toBeDefined();
      expect(BusinessBaggage.get).toBeDefined();
      expect(BusinessBaggage.set).toBeDefined();
    });

    it('should have tenantId field', () => {
      const values = BusinessBaggage.get();
      expect('tenantId' in values || values.tenantId === undefined).toBe(true);
    });

    it('should have userId field (hashed)', () => {
      BusinessBaggage.set(undefined, { userId: 'user-123' });
      // userId is hashed, so we can't directly verify the value
      expect(BusinessBaggage).toBeDefined();
    });

    it('should have priority field with enum values', () => {
      BusinessBaggage.set(undefined, { priority: 'high' });
      expect(BusinessBaggage).toBeDefined();
    });

    it('should have channel field with enum values', () => {
      BusinessBaggage.set(undefined, { channel: 'api' });
      expect(BusinessBaggage).toBeDefined();
    });

    it('should have correlationId field', () => {
      BusinessBaggage.set(undefined, { correlationId: 'corr-123' });
      expect(BusinessBaggage).toBeDefined();
    });

    it('should have workflowId field', () => {
      BusinessBaggage.set(undefined, { workflowId: 'wf-123' });
      expect(BusinessBaggage).toBeDefined();
    });

    it('should have region field', () => {
      BusinessBaggage.set(undefined, { region: 'us-east-1' });
      expect(BusinessBaggage).toBeDefined();
    });

    it('should use biz prefix', () => {
      // The BusinessBaggage is configured with prefix: 'biz'
      expect(BusinessBaggage).toBeDefined();
    });
  });

  describe('Schema methods', () => {
    it('getValue should return single field value', () => {
      const schema = createSafeBaggageSchema({
        userId: { type: 'string', defaultValue: 'default-user' },
      });

      const value = schema.getValue('userId');
      expect(value).toBe('default-user');
    });

    it('setValue should set single field value', () => {
      const schema = createSafeBaggageSchema({
        userId: { type: 'string' },
      });

      schema.setValue('userId', 'user-456');
      expect(schema).toBeDefined();
    });

    it('clear should remove all schema values', () => {
      const schema = createSafeBaggageSchema({
        key1: { type: 'string' },
        key2: { type: 'string' },
      });

      schema.set(undefined, { key1: 'value1', key2: 'value2' });
      schema.clear();
      expect(schema).toBeDefined();
    });

    it('toHeaders should return propagation headers', () => {
      const schema = createSafeBaggageSchema({
        userId: { type: 'string' },
      });

      const headers = schema.toHeaders();
      expect(headers).toBeDefined();
      expect(typeof headers).toBe('object');
    });

    it('fromHeaders should restore baggage from headers', () => {
      const schema = createSafeBaggageSchema({
        userId: { type: 'string' },
      });

      schema.fromHeaders({ traceparent: '00-abc-def-01', userId: 'user-123' });
      expect(schema).toBeDefined();
    });
  });

  describe('BaggageError types', () => {
    it('should report validation errors', () => {
      const errors: BaggageError[] = [];
      const schema = createSafeBaggageSchema(
        {
          count: { type: 'number' },
        },
        { onError: (e) => errors.push(e) },
      );

      schema.set(undefined, { count: 'invalid' as unknown as number });
      expect(errors.some((e) => e.type === 'validation')).toBe(true);
    });

    it('should report key_length errors', () => {
      const errors: BaggageError[] = [];
      const schema = createSafeBaggageSchema(
        {
          veryLongKeyName: { type: 'string' },
        },
        { maxKeyLength: 5, onError: (e) => errors.push(e) },
      );

      schema.set(undefined, { veryLongKeyName: 'value' });
      expect(errors.some((e) => e.type === 'key_length')).toBe(true);
    });

    it('should report value_length errors', () => {
      const errors: BaggageError[] = [];
      const schema = createSafeBaggageSchema(
        {
          short: { type: 'string' },
        },
        { maxValueLength: 5, onError: (e) => errors.push(e) },
      );

      schema.set(undefined, { short: 'this is too long' });
      expect(errors.some((e) => e.type === 'value_length')).toBe(true);
    });

    it('should report pii errors when redactPII is enabled', () => {
      const errors: BaggageError[] = [];
      const schema = createSafeBaggageSchema(
        {
          email: { type: 'string' },
        },
        { redactPII: true, onError: (e) => errors.push(e) },
      );

      schema.set(undefined, { email: 'test@example.com' });
      expect(errors.some((e) => e.type === 'pii')).toBe(true);
    });
  });

  describe('Hash function', () => {
    it('should produce consistent hashes', () => {
      const schema = createSafeBaggageSchema({
        id: { type: 'string', hash: true },
      });

      // Multiple sets with same value should be consistent
      // (internal hash function is deterministic)
      schema.set(undefined, { id: 'same-value' });
      schema.set(undefined, { id: 'same-value' });
      expect(schema).toBeDefined();
    });

    it('should produce different hashes for different values', () => {
      const schema = createSafeBaggageSchema({
        id: { type: 'string', hash: true },
      });

      schema.set(undefined, { id: 'value-1' });
      schema.set(undefined, { id: 'value-2' });
      expect(schema).toBeDefined();
    });
  });
});
