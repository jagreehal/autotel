import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestLoggerSafe, hasTracerProvider, otelTrace } from 'autotel';
import {
  configureAudit,
  forceKeepAuditEvent,
  setAuditAttributes,
  withAudit,
  type AuditContext,
  type AuditMetadata,
} from './index';

const setAttribute = vi.fn();
const setAttributes = vi.fn();
// SAFETY: an AuditContext is a trace context; this fake implements every method
// the audit helpers call on one, and the assertion covers the members of the
// full interface that they never reach.
const mockCtx = {
  traceId: 'trace-1',
  spanId: 'span-1',
  correlationId: 'corr-1',
  setAttribute,
  setAttributes,
  setStatus: vi.fn(),
  addLink: vi.fn(),
  addLinks: vi.fn(),
  updateName: vi.fn(),
  isRecording: vi.fn(() => true),
  recordError: vi.fn(),
  track: vi.fn(),
  getBaggage: vi.fn(),
  setBaggage: vi.fn(),
  deleteBaggage: vi.fn(),
  getAllBaggage: vi.fn(),
  getTypedBaggage: vi.fn(),
  setTypedBaggage: vi.fn(),
  withBaggage: vi.fn(),
} as AuditContext;

const logger = {
  set: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  getContext: vi.fn(() => ({})),
  emitNow: vi.fn(() => ({
    timestamp: new Date().toISOString(),
    traceId: 'trace-1',
    spanId: 'span-1',
    correlationId: 'corr-1',
    context: {},
  })),
  fork: vi.fn(),
};

vi.mock('autotel', () => ({
  AUTOTEL_SAMPLING_TAIL_EVALUATED: 'autotel.sampling.tail.evaluated',
  AUTOTEL_SAMPLING_TAIL_KEEP: 'autotel.sampling.tail.keep',
  createCounter: vi.fn(() => ({ add: vi.fn() })),
  REDACTOR_PATTERNS: {
    sensitiveKey:
      /^(password|passwd|pwd|secret|token|api[_-]?key|auth|credential|private[_-]?key|authorization)$/i,
  },
  getTraceContext: vi.fn(() => mockCtx),
  getRequestLogger: vi.fn(() => logger),
  getRequestLoggerSafe: vi.fn(() => logger),
  createNoopRequestLogger: vi.fn(() => logger),
  forceKeep: vi.fn(),
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

describe('autotel-audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forceKeepAuditEvent sets tail keep attributes', () => {
    forceKeepAuditEvent(mockCtx);

    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.sampling.tail.evaluated',
      true,
    );
    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.sampling.tail.keep',
      true,
    );
    expect(setAttribute).toHaveBeenCalledWith('autotel.audit.force_keep', true);
  });

  it('setAuditAttributes writes audit.* attributes', () => {
    const metadata: AuditMetadata = {
      action: 'user.delete',
      resource: 'account',
      actorId: 'admin-1',
    };

    setAuditAttributes(metadata, mockCtx);

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'autotel.audit': true,
        'audit.action': 'user.delete',
        'audit.resource': 'account',
        'audit.actorId': 'admin-1',
      }),
    );
  });

  it('withAudit marks success and optionally emits', async () => {
    const result = await withAudit(
      { action: 'permission.update', resource: 'role' },
      async () => 'ok',
      { emitNow: true },
    );

    expect(result).toBe('ok');
    expect(logger.set).toHaveBeenCalled();
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'audit.outcome': 'success',
      }),
    );
    expect(logger.emitNow).toHaveBeenCalledTimes(1);
  });

  it('withAudit marks failure and rethrows', async () => {
    await expect(
      withAudit({ action: 'secrets.read' }, async () => {
        throw new Error('denied');
      }),
    ).rejects.toThrow('denied');

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'audit.outcome': 'failure',
      }),
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('autotel-audit best-effort (onMissingContext)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the handler un-audited and warns once by default when no context', async () => {
    vi.mocked(otelTrace.getActiveSpan).mockReturnValueOnce(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await withAudit(
      { action: 'missing.default' },
      async () => 'ran',
    );

    expect(result).toBe('ran');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(setAttributes).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws when onMissingContext is "throw"', async () => {
    vi.mocked(otelTrace.getActiveSpan).mockReturnValueOnce(undefined);

    await expect(
      withAudit({ action: 'missing.throw' }, async () => 'x', {
        onMissingContext: 'throw',
      }),
    ).rejects.toThrow('No active trace context');
  });

  it('runs silently when onMissingContext is "skip"', async () => {
    vi.mocked(otelTrace.getActiveSpan).mockReturnValueOnce(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await withAudit(
      { action: 'missing.skip' },
      async () => 'ran',
      { onMissingContext: 'skip' },
    );

    expect(result).toBe('ran');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('autotel-audit default onMissingContext', () => {
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

  const telemetryOff = () =>
    vi.mocked(hasTracerProvider).mockReturnValue(false);
  const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('is silent when telemetry is off (no init, no provider)', async () => {
    telemetryOff();
    const warn = spyWarn();
    await expect(
      withAudit({ action: 'off.silent' }, () => 'ran'),
    ).resolves.toBe('ran');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once per action when a provider is registered but no span is active', async () => {
    const warn = spyWarn();
    await withAudit({ action: 'on.outside' }, () => 'ran');
    await withAudit({ action: 'on.outside' }, () => 'ran');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('still warns with an explicit "warn" when telemetry is off', async () => {
    telemetryOff();
    const warn = spyWarn();
    await withAudit({ action: 'off.explicit-warn' }, () => 'ran', {
      onMissingContext: 'warn',
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('still throws with an explicit "throw" when telemetry is off', async () => {
    telemetryOff();
    await expect(
      withAudit({ action: 'off.throw' }, () => 'x', {
        onMissingContext: 'throw',
      }),
    ).rejects.toThrow('No active trace context');
  });

  it('applies the configureAudit default, overridden per call', async () => {
    configureAudit({ onMissingContext: 'throw' });
    await expect(withAudit({ action: 'cfg.throw' }, () => 'x')).rejects.toThrow(
      'No active trace context',
    );
    await expect(
      withAudit({ action: 'cfg.override' }, () => 'ran', {
        onMissingContext: 'skip',
      }),
    ).resolves.toBe('ran');
  });

  it('skips the "No request logger" warning when telemetry is off', async () => {
    telemetryOff();
    const warn = spyWarn();
    vi.mocked(getRequestLoggerSafe).mockReturnValueOnce(null);
    await withAudit({ action: 'off.no-logger' }, () => 'ran', { ctx: mockCtx });
    expect(warn).not.toHaveBeenCalled();
  });
});
