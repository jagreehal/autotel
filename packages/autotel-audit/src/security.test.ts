import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasTracerProvider, otelTrace } from 'autotel';
import type { SecurityAttributeValue } from './security.js';
import { configureAudit, type AuditContext } from './index.js';
import {
  hashIdentifier,
  securityEvent,
  withSecurity,
  type SecurityEventMetadata,
} from './security';

const setAttribute = vi.fn();
const setAttributes = vi.fn();
// SAFETY: a security event needs a trace context; this fake implements every
// method the helpers call on one, and the assertion covers the rest of the
// interface, which these paths never reach.
const mockCtx = {
  traceId: 'trace-1',
  spanId: 'span-1',
  correlationId: 'corr-1',
  setAttribute,
  setAttributes,
} as AuditContext;

const logger = {
  set: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  getContext: vi.fn(() => ({})),
  emitNow: vi.fn(),
  fork: vi.fn(),
};

const counterAdd = vi.fn();

vi.mock('autotel', () => ({
  AUTOTEL_SAMPLING_TAIL_EVALUATED: 'autotel.sampling.tail.evaluated',
  AUTOTEL_SAMPLING_TAIL_KEEP: 'autotel.sampling.tail.keep',
  createCounter: vi.fn(() => ({ add: counterAdd })),
  REDACTOR_PATTERNS: {
    sensitiveKey:
      /^(password|passwd|pwd|secret|token|api[_-]?key|auth|credential|private[_-]?key|authorization)$/i,
  },
  getRequestLogger: vi.fn(() => logger),
  getRequestLoggerSafe: vi.fn(() => logger),
  createNoopRequestLogger: vi.fn(() => logger),
  getTraceContext: vi.fn(() => mockCtx),
  isInitialized: vi.fn(() => false),
  hasTracerProvider: vi.fn(() => true),
  otelTrace: {
    getActiveSpan: vi.fn(() => ({
      setAttribute,
      setAttributes,
      spanContext: () => ({ traceId: 'trace-1', spanId: 'span-1' }),
    })),
  },
}));

describe('securityEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes security.* attributes with the stable schema', () => {
    securityEvent(
      {
        name: 'auth.login.failed',
        category: 'authentication',
        outcome: 'failure',
        severity: 'warning',
        actorId: 'user-1',
        tenantId: 'tenant-1',
        reason: 'invalid_password',
      },
      { ctx: mockCtx },
    );

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'autotel.security': true,
        'security.event': 'auth.login.failed',
        'security.category': 'authentication',
        'security.outcome': 'failure',
        'security.severity': 'warning',
        'security.actor_id': 'user-1',
        'security.tenant_id': 'tenant-1',
        'security.reason': 'invalid_password',
      }),
    );
  });

  it('force-keeps through tail sampling by default', () => {
    securityEvent(
      { name: 'access.denied', category: 'authorization', outcome: 'denied' },
      { ctx: mockCtx },
    );

    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.sampling.tail.evaluated',
      true,
    );
    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.sampling.tail.keep',
      true,
    );
    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.security.force_keep',
      true,
    );
  });

  it('can opt out of force-keep', () => {
    securityEvent(
      {
        name: 'auth.login.success',
        category: 'authentication',
        outcome: 'success',
      },
      { ctx: mockCtx, forceKeep: false },
    );

    expect(setAttribute).not.toHaveBeenCalledWith(
      'autotel.sampling.tail.keep',
      true,
    );
  });

  it('defaults severity to info', () => {
    securityEvent(
      { name: 'config.changed', category: 'configuration', outcome: 'success' },
      { ctx: mockCtx },
    );

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'security.severity': 'info' }),
    );
  });

  it('drops values under credential-shaped keys', () => {
    securityEvent(
      {
        name: 'api_key.created',
        category: 'secrets',
        outcome: 'success',
        token: 'npm_70abc',
        apiKey: 'sk-live-123',
        keyId: 'key-1',
      },
      { ctx: mockCtx },
    );

    // SAFETY: securityEvent calls setAttributes once, with the flattened bag;
    // the assertions below are what that bag must and must not contain.
    const attrs = setAttributes.mock.calls[0]?.[0] as Record<
      string,
      SecurityAttributeValue | undefined
    >;
    expect(attrs['security.token']).toBeUndefined();
    expect(attrs['security.apiKey']).toBeUndefined();
    expect(attrs['security.keyId']).toBe('key-1');
    expect(attrs['security.dropped_keys']).toEqual(
      expect.arrayContaining(['token', 'apiKey']),
    );
  });

  it('flattens custom metadata under security.*', () => {
    securityEvent(
      {
        name: 'rate_limit.exceeded',
        category: 'rate_limit',
        outcome: 'blocked',
        limit: 100,
        windowSeconds: 60,
      },
      { ctx: mockCtx },
    );

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'security.limit': 100,
        'security.windowSeconds': 60,
      }),
    );
  });

  it('sets logger context and optionally emits', () => {
    securityEvent(
      {
        name: 'webhook.signature.failed',
        category: 'validation',
        outcome: 'blocked',
        severity: 'error',
        reason: 'bad_signature',
      },
      { ctx: mockCtx, emitNow: true },
    );

    expect(logger.set).toHaveBeenCalledWith({
      security: {
        name: 'webhook.signature.failed',
        category: 'validation',
        outcome: 'blocked',
        severity: 'error',
        reason: 'bad_signature',
        forceKeep: true,
      },
    });
    expect(logger.emitNow).toHaveBeenCalledTimes(1);
  });

  it('feeds the autotel.security.events counter by default', () => {
    securityEvent(
      {
        name: 'access.denied',
        category: 'authorization',
        outcome: 'denied',
        severity: 'warning',
      },
      { ctx: mockCtx },
    );

    expect(counterAdd).toHaveBeenCalledWith(1, {
      event: 'access.denied',
      category: 'authorization',
      outcome: 'denied',
      severity: 'warning',
    });
  });

  it('can opt out of metrics', () => {
    securityEvent(
      {
        name: 'auth.login.success',
        category: 'authentication',
        outcome: 'success',
      },
      { ctx: mockCtx, metrics: false },
    );

    expect(counterAdd).not.toHaveBeenCalled();
  });
});

describe('withSecurity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the event with the given outcome on success', async () => {
    const metadata: SecurityEventMetadata = {
      name: 'api_key.created',
      category: 'secrets',
      outcome: 'success',
      actorId: 'admin-1',
    };

    const result = await withSecurity(metadata, async () => 'created', {
      ctx: mockCtx,
    });

    expect(result).toBe('created');
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'security.event': 'api_key.created',
        'security.outcome': 'success',
      }),
    );
  });

  it('records outcome error, logs, and rethrows on failure', async () => {
    await expect(
      withSecurity(
        {
          name: 'secret.accessed',
          category: 'secrets',
          outcome: 'success',
        },
        async () => {
          throw new Error('vault unreachable');
        },
        { ctx: mockCtx },
      ),
    ).rejects.toThrow('vault unreachable');

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'security.outcome': 'error',
        'security.severity': 'error',
      }),
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('escalates an explicit low severity to error on failure', async () => {
    await expect(
      withSecurity(
        {
          name: 'api_key.created',
          category: 'secrets',
          outcome: 'success',
          severity: 'info',
        },
        async () => {
          throw new Error('boom');
        },
        { ctx: mockCtx },
      ),
    ).rejects.toThrow('boom');

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'security.outcome': 'error',
        'security.severity': 'error',
      }),
    );
  });

  it('keeps an explicit critical severity on failure', async () => {
    await expect(
      withSecurity(
        {
          name: 'secret.rotation.failed',
          category: 'secrets',
          outcome: 'success',
          severity: 'critical',
        },
        async () => {
          throw new Error('boom');
        },
        { ctx: mockCtx },
      ),
    ).rejects.toThrow('boom');

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'security.outcome': 'error',
        'security.severity': 'critical',
      }),
    );
  });
});

describe('hashIdentifier', () => {
  it('is stable for the same input', () => {
    expect(hashIdentifier('user@example.com')).toBe(
      hashIdentifier('user@example.com'),
    );
  });

  it('differs across inputs and salts', () => {
    expect(hashIdentifier('a@example.com')).not.toBe(
      hashIdentifier('b@example.com'),
    );
    expect(hashIdentifier('a@example.com', { salt: 's1' })).not.toBe(
      hashIdentifier('a@example.com', { salt: 's2' }),
    );
  });

  it('never contains the raw value and defaults to 16 chars', () => {
    const digest = hashIdentifier('user@example.com');
    expect(digest).toHaveLength(16);
    expect(digest).not.toContain('user');
    expect(digest).toMatch(/^[0-9a-f]+$/);
  });
});

describe('securityEvent default onMissingContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(otelTrace.getActiveSpan).mockReturnValue(undefined);
  });
  afterEach(() => {
    vi.mocked(otelTrace.getActiveSpan).mockReset();
    vi.mocked(hasTracerProvider).mockReturnValue(true);
    configureAudit({ onMissingContext: undefined });
    vi.restoreAllMocks();
  });

  const event = (name: string) =>
    ({ name, category: 'authentication', outcome: 'failure' }) as const;
  const telemetryOff = () =>
    vi.mocked(hasTracerProvider).mockReturnValue(false);
  const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('is silent when telemetry is off (no init, no provider)', () => {
    telemetryOff();
    const warn = spyWarn();
    securityEvent(event('off.silent'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once per event when a provider is registered but no span is active', () => {
    const warn = spyWarn();
    securityEvent(event('on.outside'));
    securityEvent(event('on.outside'));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('still warns with an explicit "warn" when telemetry is off', () => {
    telemetryOff();
    const warn = spyWarn();
    securityEvent(event('off.explicit-warn'), { onMissingContext: 'warn' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('still throws with an explicit "throw" when telemetry is off', () => {
    telemetryOff();
    expect(() =>
      securityEvent(event('off.throw'), { onMissingContext: 'throw' }),
    ).toThrow('No active trace context');
  });

  it('applies the configureAudit default, overridden per call', () => {
    configureAudit({ onMissingContext: 'throw' });
    expect(() => securityEvent(event('cfg.throw'))).toThrow(
      'No active trace context',
    );
    expect(() =>
      securityEvent(event('cfg.override'), { onMissingContext: 'skip' }),
    ).not.toThrow();
  });
});
