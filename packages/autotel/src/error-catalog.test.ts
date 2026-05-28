import { describe, it, expect } from 'vitest';
import {
  defineErrorCatalog,
  defineAuditCatalog,
  isCatalogError,
  getCatalogCode,
} from './error-catalog';

describe('defineErrorCatalog', () => {
  const billing = defineErrorCatalog('billing', {
    PAYMENT_DECLINED: {
      status: 402,
      message: 'Card declined',
      why: 'The issuer rejected the charge',
      fix: 'Try a different payment method',
      link: 'https://docs.example.com/billing',
    },
    INSUFFICIENT_FUNDS: {
      status: 402,
      message: ({
        available,
        required,
      }: {
        available: number;
        required: number;
      }) => `Insufficient funds: $${available} of $${required}`,
      why: ({ required }: { available: number; required: number }) =>
        `Needs $${required}`,
    },
    LEGACY: {
      code: 'BILLING_LEGACY_42',
      message: 'Legacy failure',
    },
  });

  it('builds a structured error from a static entry', () => {
    const err = billing.PAYMENT_DECLINED();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Card declined');
    expect(err.status).toBe(402);
    expect(err.why).toBe('The issuer rejected the charge');
    expect(err.fix).toBe('Try a different payment method');
    expect(err.link).toBe('https://docs.example.com/billing');
    expect(err.code).toBe('billing.PAYMENT_DECLINED');
    expect(err.name).toBe('PAYMENT_DECLINED');
  });

  it('interpolates typed params in message and why', () => {
    const err = billing.INSUFFICIENT_FUNDS({ available: 5, required: 100 });
    expect(err.message).toBe('Insufficient funds: $5 of $100');
    expect(err.why).toBe('Needs $100');
  });

  it('honors a custom code', () => {
    const err = billing.LEGACY();
    expect(err.code).toBe('BILLING_LEGACY_42');
  });

  it('exposes the code on the builder', () => {
    expect(billing.PAYMENT_DECLINED.code).toBe('billing.PAYMENT_DECLINED');
    expect(billing.LEGACY.code).toBe('BILLING_LEGACY_42');
  });

  it('matches its own errors and rejects others', () => {
    const declined = billing.PAYMENT_DECLINED();
    const funds = billing.INSUFFICIENT_FUNDS({ available: 1, required: 2 });
    expect(billing.PAYMENT_DECLINED.match(declined)).toBe(true);
    expect(billing.PAYMENT_DECLINED.match(funds)).toBe(false);
    expect(billing.PAYMENT_DECLINED.match(new Error('nope'))).toBe(false);
    expect(billing.PAYMENT_DECLINED.match(null)).toBe(false);
  });

  it('tags errors so isCatalogError / getCatalogCode work', () => {
    const err = billing.PAYMENT_DECLINED();
    expect(isCatalogError(err)).toBe(true);
    expect(isCatalogError(new Error('plain'))).toBe(false);
    expect(getCatalogCode(err)).toBe('billing.PAYMENT_DECLINED');
    expect(getCatalogCode(new Error('plain'))).toBeUndefined();
  });

  it('passes cause, details, and internal through build options', () => {
    const cause = new Error('stripe boom');
    const err = billing.PAYMENT_DECLINED({
      cause,
      details: { attempt: 2 },
      internal: { stripeId: 'ch_1' },
    });
    expect(err.cause).toBe(cause);
    expect(err.details).toEqual({ attempt: 2 });
    expect(err.internal).toEqual({ stripeId: 'ch_1' });
  });

  it('accepts options as the second arg for param entries', () => {
    const cause = new Error('root');
    const err = billing.INSUFFICIENT_FUNDS(
      { available: 5, required: 100 },
      { cause },
    );
    expect(err.message).toBe('Insufficient funds: $5 of $100');
    expect(err.cause).toBe(cause);
  });
});

describe('defineAuditCatalog', () => {
  const audit = defineAuditCatalog('user', {
    LOGIN: { message: 'User logged in' },
    ROLE_CHANGED: {
      severity: 'critical',
      message: ({ role }: { role: string }) => `Role set to ${role}`,
    },
    DELETED: { action: 'user.account.deleted', severity: 'warn' },
  });

  it('produces typed action descriptors with defaults', () => {
    const action = audit.LOGIN();
    expect(action.action).toBe('user.LOGIN');
    expect(action.severity).toBe('info');
    expect(action.message).toBe('User logged in');
  });

  it('interpolates params and respects severity', () => {
    const action = audit.ROLE_CHANGED({ role: 'admin' });
    expect(action.action).toBe('user.ROLE_CHANGED');
    expect(action.severity).toBe('critical');
    expect(action.message).toBe('Role set to admin');
  });

  it('honors a custom action name', () => {
    expect(audit.DELETED.action).toBe('user.account.deleted');
    expect(audit.DELETED.severity).toBe('warn');
    expect(audit.DELETED().message).toBeUndefined();
  });
});
