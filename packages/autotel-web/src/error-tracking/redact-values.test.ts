import { describe, it, expect } from 'vitest';
import { createStringRedactor } from './redact-values';

describe('createStringRedactor', () => {
  it('redacts emails with default preset', () => {
    const redact = createStringRedactor('default');
    expect(redact('Contact john@example.com for help')).toBe(
      'Contact [REDACTED] for help',
    );
  });

  it('redacts credit cards with default preset', () => {
    const redact = createStringRedactor('default');
    expect(redact('Card: 4111-1111-1111-1111')).toBe('Card: [REDACTED]');
  });

  it('redacts every matching value in the same string', () => {
    const redact = createStringRedactor('default');
    expect(redact('Contacts: a@example.com and b@example.com')).toBe(
      'Contacts: [REDACTED] and [REDACTED]',
    );
  });

  it('returns input unchanged when no match', () => {
    const redact = createStringRedactor('default');
    expect(redact('hello world')).toBe('hello world');
  });

  it('redacts bearer tokens with strict preset', () => {
    const redact = createStringRedactor('strict');
    expect(redact('Auth: Bearer abc123.xyz')).toBe('Auth: [REDACTED]');
  });

  it('pci-dss preset only redacts credit cards', () => {
    const redact = createStringRedactor('pci-dss');
    // Credit card is redacted
    expect(redact('Card: 4111-1111-1111-1111')).toBe('Card: [REDACTED]');
    // Email is NOT redacted in pci-dss
    expect(redact('user@example.com')).toBe('user@example.com');
  });

  it('accepts custom config with custom patterns', () => {
    const redact = createStringRedactor({
      valuePatterns: [
        { name: 'customId', pattern: /CUST-\d+/g, replacement: 'CUST-***' },
      ],
    });
    expect(redact('User CUST-12345 logged in')).toBe('User CUST-*** logged in');
  });
});
