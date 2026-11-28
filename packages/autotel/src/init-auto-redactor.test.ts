import { describe, it, expect, afterEach } from 'vitest';
import { resolveAttributeRedactor } from './init';

const ORIGINAL = process.env.AUTOTEL_REDACT_PII;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.AUTOTEL_REDACT_PII;
  } else {
    process.env.AUTOTEL_REDACT_PII = ORIGINAL;
  }
});

describe('resolveAttributeRedactor', () => {
  it('auto-enables the default preset in production', () => {
    delete process.env.AUTOTEL_REDACT_PII;
    expect(resolveAttributeRedactor(undefined, 'production')).toBe('default');
  });

  it('matches production in any case', () => {
    delete process.env.AUTOTEL_REDACT_PII;
    expect(resolveAttributeRedactor(undefined, 'Production')).toBe('default');
    expect(resolveAttributeRedactor(undefined, 'PRODUCTION')).toBe('default');
  });

  it('masks only URL query values in non-production environments', () => {
    delete process.env.AUTOTEL_REDACT_PII;
    expect(resolveAttributeRedactor(undefined, 'development')).toEqual({
      urlQueryValues: true,
    });
    expect(resolveAttributeRedactor(undefined, 'staging')).toEqual({
      urlQueryValues: true,
    });
  });

  it('lets AUTOTEL_REDACT_PII=off keep query values outside production', () => {
    process.env.AUTOTEL_REDACT_PII = 'off';
    expect(resolveAttributeRedactor(undefined, 'development')).toBeUndefined();
  });

  it('honors an explicit preset in any environment', () => {
    expect(resolveAttributeRedactor('strict', 'development')).toBe('strict');
  });

  it('honors an explicit custom config object', () => {
    const config = { keyPatterns: [/password/i] };
    expect(resolveAttributeRedactor(config, 'production')).toBe(config);
  });

  it('disables redaction when explicitly set to false, even in production', () => {
    expect(resolveAttributeRedactor(false, 'production')).toBeUndefined();
  });

  it('lets AUTOTEL_REDACT_PII=off disable auto-enable in production', () => {
    process.env.AUTOTEL_REDACT_PII = 'off';
    expect(resolveAttributeRedactor(undefined, 'production')).toBeUndefined();
  });

  it('lets AUTOTEL_REDACT_PII select a preset in any environment', () => {
    process.env.AUTOTEL_REDACT_PII = 'strict';
    expect(resolveAttributeRedactor(undefined, 'development')).toBe('strict');
  });

  it('treats AUTOTEL_REDACT_PII truthy flags as the default preset', () => {
    process.env.AUTOTEL_REDACT_PII = 'true';
    expect(resolveAttributeRedactor(undefined, 'development')).toBe('default');
  });
});
