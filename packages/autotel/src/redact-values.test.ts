import { describe, it, expect, beforeEach } from 'vitest';
import { createStringRedactor } from './redact-values';
import type { StringRedactor } from './redact-values';

describe('createStringRedactor', () => {
  describe('default preset', () => {
    let redact: StringRedactor;

    beforeEach(() => {
      redact = createStringRedactor('default');
    });

    it('smart-masks emails', () => {
      expect(redact('Contact user@example.com for info')).toBe(
        'Contact u***@***.com for info',
      );
    });

    it('smart-masks international phone numbers (country code + last 2 digits)', () => {
      expect(redact('Call +33 1 23 45 67 89 now')).toBe('Call +33******89 now');
    });

    it('smart-masks phone numbers with parens (last 2 digits)', () => {
      expect(redact('Call (415) 555-1234 now')).toBe('Call ********34 now');
    });

    it('smart-masks common US phone formats', () => {
      expect(redact('Call 555-123-4567 now')).toBe('Call ********67 now');
      expect(redact('Call 5551234567 now')).toBe('Call ********67 now');
    });

    it('does not mistake bare digit runs for phone numbers', () => {
      // UUIDs, order ids etc. should pass through untouched.
      expect(redact('Order: 12345678 ok')).toBe('Order: 12345678 ok');
    });

    it('smart-masks credit card numbers (last four digits preserved)', () => {
      expect(redact('Card: 4111-1111-1111-1111')).toBe('Card: ****1111');
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

    it('smart-masks JWTs', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123_-def';
      expect(redact(`Token: ${jwt}`)).toBe('Token: eyJ***.***');
    });

    it('smart-masks bearer tokens', () => {
      expect(redact('Authorization: Bearer abc123.xyz')).toBe(
        'Authorization: Bearer ***',
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
