import { describe, it, expect } from 'vitest';
import { createRedactor, REDACT_PRESETS } from './redact';

describe('createRedactor', () => {
  describe('basic paths', () => {
    it('should support built-in preset names', () => {
      const redact = createRedactor('default');
      expect(
        redact({
          password: 'secret',
          headers: { authorization: 'Bearer token' },
          safe: 'visible',
        }),
      ).toEqual({
        password: '[Redacted]',
        headers: { authorization: '[Redacted]' },
        safe: 'visible',
      });
    });

    it('should redact a top-level string key', () => {
      const redact = createRedactor({ paths: ['password'] });
      expect(redact({ password: 'secret', name: 'Alice' })).toEqual({
        password: '[Redacted]',
        name: 'Alice',
      });
    });

    it('should redact multiple top-level keys', () => {
      const redact = createRedactor({ paths: ['password', 'token'] });
      expect(redact({ password: 's', token: 't', id: 1 })).toEqual({
        password: '[Redacted]',
        token: '[Redacted]',
        id: 1,
      });
    });

    it('should not add redacted keys that do not exist', () => {
      const redact = createRedactor({ paths: ['missing'] });
      expect(redact({ name: 'Alice' })).toEqual({ name: 'Alice' });
    });

    it('should handle null/undefined input', () => {
      const redact = createRedactor({ paths: ['password'] });
      expect(redact(null)).toBeNull();
      // eslint-disable-next-line unicorn/no-useless-undefined
      expect(redact(undefined)).toBeUndefined();
      expect(redact(42 as any)).toBe(42);
    });

    it('should handle empty paths array', () => {
      const redact = createRedactor({ paths: [] });
      expect(redact({ password: 'secret' })).toEqual({ password: 'secret' });
    });
  });

  describe('deep paths', () => {
    it('should redact nested fields', () => {
      const redact = createRedactor({ paths: ['user.email'] });
      expect(redact({ user: { email: 'a@b.com', name: 'Alice' } })).toEqual({
        user: { email: '[Redacted]', name: 'Alice' },
      });
    });

    it('should redact deeply nested fields', () => {
      const redact = createRedactor({ paths: ['a.b.c'] });
      expect(redact({ a: { b: { c: 'secret', d: 'ok' } } })).toEqual({
        a: { b: { c: '[Redacted]', d: 'ok' } },
      });
    });

    it('should redact multiple nested paths', () => {
      const redact = createRedactor({
        paths: ['user.email', 'user.password'],
      });
      expect(
        redact({ user: { email: 'a@b.com', password: 's', name: 'A' } }),
      ).toEqual({
        user: { email: '[Redacted]', password: '[Redacted]', name: 'A' },
      });
    });

    it('should handle missing intermediate objects', () => {
      const redact = createRedactor({ paths: ['user.email'] });
      expect(redact({ other: true })).toEqual({ other: true });
    });
  });

  describe('wildcards', () => {
    it('should redact all properties with top-level wildcard', () => {
      const redact = createRedactor({ paths: ['secrets.*'] });
      expect(redact({ secrets: { a: '1', b: '2' } })).toEqual({
        secrets: { a: '[Redacted]', b: '[Redacted]' },
      });
    });

    it('should redact all array items with wildcard', () => {
      const redact = createRedactor({ paths: ['users[*].password'] });
      expect(
        redact({
          users: [
            { name: 'A', password: 'p1' },
            { name: 'B', password: 'p2' },
          ],
        }),
      ).toEqual({
        users: [
          { name: 'A', password: '[Redacted]' },
          { name: 'B', password: '[Redacted]' },
        ],
      });
    });

    it('should handle wildcard at root level', () => {
      const redact = createRedactor({ paths: ['[*].secret'] });
      expect(
        redact([
          { secret: 'a', id: 1 },
          { secret: 'b', id: 2 },
        ]),
      ).toEqual([
        { secret: '[Redacted]', id: 1 },
        { secret: '[Redacted]', id: 2 },
      ]);
    });

    it('should handle wildcard on non-object gracefully', () => {
      const redact = createRedactor({ paths: ['items.*'] });
      expect(redact({ items: 'string-value' })).toEqual({
        items: 'string-value',
      });
    });

    it('should handle wildcard on empty object', () => {
      const redact = createRedactor({ paths: ['data.*'] });
      expect(redact({ data: {} })).toEqual({ data: {} });
    });
  });

  describe('custom censor', () => {
    it('should use a custom censor string', () => {
      const redact = createRedactor({
        paths: ['password'],
        censor: '***',
      });
      expect(redact({ password: 'secret' })).toEqual({ password: '***' });
    });

    it('should use a censor function', () => {
      const redact = createRedactor({
        paths: ['ccn'],
        censor: (val) => '****' + String(val).slice(-4),
      });
      expect(redact({ ccn: '4111111111111234' })).toEqual({
        ccn: '****1234',
      });
    });

    it('should pass the original value to censor function', () => {
      let received: unknown;
      const redact = createRedactor({
        paths: ['secret'],
        censor: (val) => {
          received = val;
          return 'hidden';
        },
      });
      redact({ secret: 'my-secret' });
      expect(received).toBe('my-secret');
    });
  });

  describe('pino-style paths', () => {
    it('should redact typical sensitive fields', () => {
      const redact = createRedactor({
        paths: ['password', 'token', 'authorization', 'cookie', 'secret'],
      });
      const input = {
        password: 'hunter2',
        token: 'jwt-abc',
        authorization: 'Bearer xyz',
        cookie: 'sid=123',
        secret: 'key',
        safe: 'visible',
      };
      expect(redact(input)).toEqual({
        password: '[Redacted]',
        token: '[Redacted]',
        authorization: '[Redacted]',
        cookie: '[Redacted]',
        secret: '[Redacted]',
        safe: 'visible',
      });
    });

    it('should redact header authorization paths', () => {
      const redact = createRedactor({
        paths: ['req.headers.authorization', 'req.headers.cookie'],
      });
      expect(
        redact({
          req: {
            headers: {
              authorization: 'Bearer token',
              cookie: 'sid=abc',
              'content-type': 'application/json',
            },
          },
        }),
      ).toEqual({
        req: {
          headers: {
            authorization: '[Redacted]',
            cookie: '[Redacted]',
            'content-type': 'application/json',
          },
        },
      });
    });
  });

  describe('does not mutate original', () => {
    it('should not mutate the original object', () => {
      const redact = createRedactor({ paths: ['password'] });
      const original = { password: 'secret', name: 'Alice' };
      redact(original);
      expect(original.password).toBe('secret');
    });

    it('should not mutate nested objects', () => {
      const redact = createRedactor({ paths: ['user.email'] });
      const original = { user: { email: 'a@b.com' } };
      redact(original);
      expect(original.user.email).toBe('a@b.com');
    });

    it('should not mutate array items', () => {
      const redact = createRedactor({ paths: ['items[*].secret'] });
      const original = { items: [{ secret: 'a' }, { secret: 'b' }] };
      redact(original);
      expect(original.items[0].secret).toBe('a');
    });
  });

  describe('overlapping paths', () => {
    it('should handle parent and child paths together', () => {
      // ['user', 'user.email'] — user is a redact target, but user.email should also be handled
      const redact = createRedactor({ paths: ['user', 'user.email'] });
      const result = redact({
        user: { email: 'a@b.com', name: 'Alice' },
      }) as any;
      // Both paths are in the tree. 'user' is marked redact AND has children.
      // The nested email should be redacted.
      expect(result.user.email).toBe('[Redacted]');
      expect(result.user.name).toBe('Alice');
    });

    it('should handle child before parent in path list', () => {
      const redact = createRedactor({ paths: ['user.email', 'user'] });
      const result = redact({
        user: { email: 'a@b.com', name: 'Alice' },
      }) as any;
      expect(result.user.email).toBe('[Redacted]');
    });

    it('should handle deeply overlapping paths', () => {
      const redact = createRedactor({ paths: ['a', 'a.b', 'a.b.c'] });
      const result = redact({ a: { b: { c: 'deep', d: 'ok' } } }) as any;
      expect(result.a.b.c).toBe('[Redacted]');
      expect(result.a.b.d).toBe('ok');
    });

    it('should handle sibling paths sharing a parent', () => {
      const redact = createRedactor({ paths: ['user.email', 'user.password'] });
      const result = redact({
        user: { email: 'a@b.com', password: 's', name: 'A' },
      }) as any;
      expect(result.user.email).toBe('[Redacted]');
      expect(result.user.password).toBe('[Redacted]');
      expect(result.user.name).toBe('A');
    });
  });

  describe('non-plain objects', () => {
    it('should pass Date through by reference', () => {
      const redact = createRedactor({ paths: ['secret'] });
      const date = new Date('2025-01-01');
      const result = redact({ secret: 'x', created: date }) as any;
      expect(result.created).toBe(date);
      expect(result.created).toBeInstanceOf(Date);
    });

    it('should pass class instances through by reference', () => {
      class Custom {
        constructor(public value: string) {}
        greet() {
          return this.value;
        }
      }
      const redact = createRedactor({ paths: ['password'] });
      const obj = new Custom('hello');
      const result = redact({ password: 's', thing: obj }) as any;
      expect(result.thing).toBe(obj);
      expect(result.thing.greet()).toBe('hello');
    });

    it('should pass Map through by reference', () => {
      const redact = createRedactor({ paths: ['secret'] });
      const map = new Map([['key', 'val']]);
      const result = redact({ secret: 'x', data: map }) as any;
      expect(result.data).toBe(map);
    });

    it('should still deep-clone nested plain objects inside arrays', () => {
      const redact = createRedactor({ paths: ['items[*].password'] });
      const original = { items: [{ password: 'p', name: 'A' }] };
      const result = redact(original) as any;
      expect(result.items[0].password).toBe('[Redacted]');
      expect(original.items[0].password).toBe('p');
    });
  });

  describe('parsePath validation', () => {
    it('should throw on empty path string', () => {
      expect(() => createRedactor({ paths: [''] })).toThrow(/non-empty string/);
    });

    it('should throw on double-dot paths', () => {
      expect(() => createRedactor({ paths: ['user..email'] })).toThrow(
        /empty segment/,
      );
    });

    it('should throw on unclosed bracket', () => {
      expect(() => createRedactor({ paths: ['user['] })).toThrow(
        /unclosed bracket/,
      );
    });

    it('should throw on trailing garbage after bracket', () => {
      expect(() => createRedactor({ paths: ['foo.]bar'] })).toThrow(/bracket/);
    });

    it('should accept valid paths without throwing', () => {
      expect(() => createRedactor({ paths: ['a'] })).not.toThrow();
      expect(() => createRedactor({ paths: ['a.b'] })).not.toThrow();
      expect(() => createRedactor({ paths: ['a[*].b'] })).not.toThrow();
      expect(() => createRedactor({ paths: ['a.*.b'] })).not.toThrow();
      expect(() => createRedactor({ paths: ['[0].secret'] })).not.toThrow();
    });
  });

  describe('return type preserves input type', () => {
    it('should return the same type as input', () => {
      const redact = createRedactor({ paths: ['password'] });
      const input = { password: 's', count: 42, active: true };
      const result = redact(input);
      // TypeScript should infer result as { password: string; count: number; active: boolean }
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
    });
  });

  describe('presets', () => {
    it('should create a redactor from "default" preset', () => {
      const redact = createRedactor('default');
      const result = redact({
        password: 'hunter2',
        secret: 'key',
        token: 'jwt-abc',
        authorization: 'Bearer xyz',
        safe: 'visible',
        req: { headers: { authorization: 'Bearer xyz', cookie: 'sid=1' } },
      }) as any;

      expect(result.password).toBe('[Redacted]');
      expect(result.secret).toBe('[Redacted]');
      expect(result.token).toBe('[Redacted]');
      expect(result.authorization).toBe('[Redacted]');
      expect(result.safe).toBe('visible');
      expect(result.req.headers.authorization).toBe('[Redacted]');
      expect(result.req.headers.cookie).toBe('[Redacted]');
    });

    it('should create a redactor from "strict" preset', () => {
      const redact = createRedactor('strict');
      const result = redact({
        password: 's',
        accessToken: 'tok',
        refreshToken: 'rtok',
        clientSecret: 'cs',
        safe: 'ok',
      }) as any;

      expect(result.password).toBe('[Redacted]');
      expect(result.accessToken).toBe('[Redacted]');
      expect(result.refreshToken).toBe('[Redacted]');
      expect(result.clientSecret).toBe('[Redacted]');
      expect(result.safe).toBe('ok');
    });

    it('should create a redactor from "pci-dss" preset', () => {
      const redact = createRedactor('pci-dss');
      const result = redact({
        cardNumber: '4111111111111111',
        cvv: '123',
        pan: '4111111111111111',
        safe: 'ok',
      }) as any;

      expect(result.cardNumber).toBe('[Redacted]');
      expect(result.cvv).toBe('[Redacted]');
      expect(result.pan).toBe('[Redacted]');
      expect(result.safe).toBe('ok');
    });

    it('should throw on unknown preset', () => {
      expect(() => createRedactor('unknown' as any)).toThrow(
        /Unknown redactor preset/,
      );
    });

    it('should export REDACT_PRESETS with all three presets', () => {
      expect(REDACT_PRESETS.default).toBeDefined();
      expect(REDACT_PRESETS.strict).toBeDefined();
      expect(REDACT_PRESETS['pci-dss']).toBeDefined();
      expect(REDACT_PRESETS.default.paths).toContain('password');
      expect(REDACT_PRESETS.strict.paths).toContain('accessToken');
      expect(REDACT_PRESETS['pci-dss'].paths).toContain('cvv');
    });
  });
});
