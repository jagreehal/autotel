/**
 * Tests for input validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateEventName,
  validateAttributes,
  validateEvent,
  ValidationError,
  getDefaultValidationConfig,
} from './validation';

describe('validateEventName()', () => {
  it('should accept valid event names', () => {
    expect(validateEventName('user.signup')).toBe('user.signup');
    expect(validateEventName('order_completed')).toBe('order_completed');
    expect(validateEventName('feature-used')).toBe('feature-used');
    expect(validateEventName('app123.event456')).toBe('app123.event456');
  });

  it('should trim whitespace', () => {
    expect(validateEventName('  user.signup  ')).toBe('user.signup');
  });

  it('should reject empty event names', () => {
    expect(() => validateEventName('')).toThrow(ValidationError);
    expect(() => validateEventName('   ')).toThrow(ValidationError);
  });

  it('should reject non-string event names', () => {
    expect(() => validateEventName(123 as any)).toThrow(ValidationError);

    expect(() => validateEventName(null as any)).toThrow(ValidationError);

    expect(() => validateEventName(undefined as any)).toThrow(ValidationError);
  });

  it('should reject event names that are too long', () => {
    const longName = 'a'.repeat(101);
    expect(() => validateEventName(longName)).toThrow(ValidationError);
  });

  it('should reject event names with invalid characters', () => {
    expect(() => validateEventName('user signup')).toThrow(ValidationError);
    expect(() => validateEventName('user@signup')).toThrow(ValidationError);
    expect(() => validateEventName('user/signup')).toThrow(ValidationError);
    expect(() => validateEventName(String.raw`user\signup`)).toThrow(
      ValidationError,
    );
  });
});

describe('validateAttributes()', () => {
  it('should accept valid attributes', () => {
    const attrs = {
      userId: '123',
      plan: 'pro',
      count: 5,
      active: true,
    };

    expect(validateAttributes(attrs)).toEqual(attrs);
  });

  it('should handle undefined attributes', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(validateAttributes(undefined)).toBeUndefined();
  });

  it('should reject non-object attributes', () => {
    expect(() => validateAttributes('string' as any)).toThrow(ValidationError);

    expect(() => validateAttributes(123 as any)).toThrow(ValidationError);

    expect(() => validateAttributes([] as any)).toThrow(ValidationError);
  });

  it('should reject too many attributes', () => {
    const config = getDefaultValidationConfig();
    const attrs: Record<string, unknown> = {};
    for (let i = 0; i < config.maxAttributeCount + 1; i++) {
      attrs[`key${i}`] = 'value';
    }

    expect(() =>
      validateAttributes(attrs as Record<string, string | number | boolean>),
    ).toThrow(ValidationError);
  });

  it('should reject attribute keys that are too long', () => {
    const longKey = 'a'.repeat(101);
    const attrs = { [longKey]: 'value' };

    expect(() => validateAttributes(attrs)).toThrow(ValidationError);
  });

  it('should truncate long string values', () => {
    const longValue = 'a'.repeat(1500);
    const attrs = { field: longValue };

    const result = validateAttributes(attrs);
    expect(result?.field).toBe('a'.repeat(1000) + '...');
  });

  it('should redact sensitive fields', () => {
    const attrs = {
      email: 'user@example.com',
      password: 'secret123',
      apiKey: 'abc123',
      normalField: 'value',
    };

    const result = validateAttributes(attrs);
    expect(result?.email).toBe('user@example.com');
    expect(result?.password).toBe('[REDACTED]');
    expect(result?.apiKey).toBe('[REDACTED]');
    expect(result?.normalField).toBe('value');
  });

  it('should redact sensitive fields in nested objects', () => {
    const attrs = {
      user: {
        password: 'secret123',
        apiKey: 'abc123',
      },
      session: {
        authToken: 'token-123',
      },
    };

    const result = validateAttributes(attrs) as
      | Record<string, Record<string, unknown>>
      | undefined;

    expect(result?.user?.password).toBe('[REDACTED]');
    expect(result?.user?.apiKey).toBe('[REDACTED]');
    expect(result?.session?.authToken).toBe('[REDACTED]');
  });

  it('should handle nested objects within depth limit', () => {
    const attrs = {
      user: {
        profile: {
          name: 'John',
        },
      },
    };

    const result = validateAttributes(
      attrs as unknown as Record<string, string | number | boolean>,
    );
    expect(result).toEqual(attrs);
  });

  it('should truncate deeply nested objects', () => {
    const attrs = {
      level1: {
        level2: {
          level3: {
            level4: {
              tooDeep: 'value',
            },
          },
        },
      },
    };

    const result = validateAttributes(attrs as any) as any;
    expect(result.level1.level2.level3.level4).toBe('[MAX_DEPTH_EXCEEDED]');
  });

  it('should handle arrays', () => {
    const attrs = {
      tags: ['tag1', 'tag2', 'tag3'],
      scores: [1, 2, 3],
    };

    const result = validateAttributes(attrs as any);
    expect(result).toEqual(attrs);
  });

  it('should handle circular references', () => {
    const circular: any = { name: 'test' };
    circular.self = circular;

    const attrs = { data: circular };

    const result = validateAttributes(attrs) as any;
    expect(result.data).toBe('[CIRCULAR]');
  });

  it('should handle null and undefined values', () => {
    const attrs = {
      nullable: null,
      undefinedField: undefined,
      normalField: 'value',
    };

    const result = validateAttributes(attrs as any);
    expect(result?.nullable).toBeNull();
    expect(result?.undefinedField).toBeUndefined();
    expect(result?.normalField).toBe('value');
  });

  it('should handle unsupported types', () => {
    const attrs = {
      func: () => {},
      symbol: Symbol('test'),
      normalField: 'value',
    };

    const result = validateAttributes(attrs as any);
    expect(result?.func).toBe('[function]');
    expect(result?.symbol).toBe('[symbol]');
    expect(result?.normalField).toBe('value');
  });
});

describe('validateEvent()', () => {
  it('should validate both event name and attributes', () => {
    const result = validateEvent('user.signup', {
      userId: '123',
      password: 'secret',
    });

    expect(result.eventName).toBe('user.signup');
    expect(result.attributes?.userId).toBe('123');
    expect(result.attributes?.password).toBe('[REDACTED]');
  });

  it('should handle events without attributes', () => {
    const result = validateEvent('page.viewed');

    expect(result.eventName).toBe('page.viewed');
    expect(result.attributes).toBeUndefined();
  });

  it('should allow custom validation config', () => {
    const result = validateEvent(
      'test.event',
      { field: 'value' },
      { maxEventNameLength: 50 },
    );

    expect(result.eventName).toBe('test.event');
    expect(result.attributes?.field).toBe('value');
  });

  it('should throw on invalid event name', () => {
    expect(() => validateEvent('', { userId: '123' })).toThrow(ValidationError);
  });

  it('should throw on invalid attributes', () => {
    expect(() => validateEvent('user.signup', 'invalid' as any)).toThrow(
      ValidationError,
    );
  });
});

describe('Sensitive data patterns', () => {
  it('should redact password fields', () => {
    const attrs = {
      password: 'secret',
      userPassword: 'secret',
      PASSWORD: 'secret',
    };

    const result = validateAttributes(attrs);
    expect(result?.password).toBe('[REDACTED]');
    expect(result?.userPassword).toBe('[REDACTED]');
    expect(result?.PASSWORD).toBe('[REDACTED]');
  });

  it('should redact token fields', () => {
    const attrs = {
      token: 'abc123',
      accessToken: 'abc123',
      auth_token: 'abc123',
    };

    const result = validateAttributes(attrs);
    expect(result?.token).toBe('[REDACTED]');
    expect(result?.accessToken).toBe('[REDACTED]');
    expect(result?.auth_token).toBe('[REDACTED]');
  });

  it('should redact API key fields', () => {
    const attrs = {
      apiKey: 'abc123',
      api_key: 'abc123',
      API_KEY: 'abc123',
    };

    const result = validateAttributes(attrs);
    expect(result?.apiKey).toBe('[REDACTED]');
    expect(result?.api_key).toBe('[REDACTED]');
    expect(result?.API_KEY).toBe('[REDACTED]');
  });

  it('should redact auth fields', () => {
    const attrs = {
      auth: 'abc123',
      authorization: 'Bearer token',
      authenticated: true, // Contains "auth" but should still be redacted
    };

    const result = validateAttributes(attrs);
    expect(result?.auth).toBe('[REDACTED]');
    expect(result?.authorization).toBe('[REDACTED]');
    expect(result?.authenticated).toBe('[REDACTED]');
  });

  it('should not redact non-sensitive fields with similar names', () => {
    const attrs = {
      email: 'user@example.com',
      username: 'john',
      userId: '123',
    };

    const result = validateAttributes(attrs);
    expect(result?.email).toBe('user@example.com');
    expect(result?.username).toBe('john');
    expect(result?.userId).toBe('123');
  });
});
