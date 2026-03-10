import { describe, it, expect, beforeEach } from 'vitest';
import { createStringRedactor } from './redact-values';
import type { StringRedactor } from './redact-values';

describe('createStringRedactor', () => {
  describe('default preset', () => {
    let redact: StringRedactor;

    beforeEach(() => {
      redact = createStringRedactor('default');
    });

    it('redacts emails', () => {
      expect(redact('Contact user@example.com for info')).toBe(
        'Contact [REDACTED] for info',
      );
    });

    it('redacts phone numbers', () => {
      expect(redact('Call 555-123-4567 now')).toBe('Call [REDACTED] now');
    });

    it('redacts credit card numbers', () => {
      expect(redact('Card: 4111-1111-1111-1111')).toBe('Card: [REDACTED]');
    });

    it('returns input unchanged when no patterns match', () => {
      expect(redact('hello world')).toBe('hello world');
    });
  });

  describe('strict preset', () => {
    let redact: StringRedactor;

    beforeEach(() => {
      redact = createStringRedactor('strict');
    });

    it('redacts JWTs', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123_-def';
      expect(redact(`Token: ${jwt}`)).toBe('Token: [REDACTED]');
    });

    it('redacts bearer tokens', () => {
      expect(redact('Authorization: Bearer abc123.xyz')).toBe(
        'Authorization: [REDACTED]',
      );
    });
  });

  describe('custom config', () => {
    it('accepts custom config with custom patterns', () => {
      const redact = createStringRedactor({
        valuePatterns: [{ name: 'customId', pattern: /CUST-\d{8}/g }],
        replacement: '***',
      });
      expect(redact('Customer CUST-12345678 logged in')).toBe(
        'Customer *** logged in',
      );
    });

    it('uses custom replacement string', () => {
      const redact = createStringRedactor({
        valuePatterns: [
          {
            name: 'email',
            pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
          },
        ],
        replacement: '<HIDDEN>',
      });
      expect(redact('Email: test@example.com')).toBe('Email: <HIDDEN>');
    });
  });
});
