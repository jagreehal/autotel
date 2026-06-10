import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forceKeepAuditEvent,
  setAuditAttributes,
  withAudit,
  type AuditMetadata,
} from './index';

const setAttribute = vi.fn();
const setAttributes = vi.fn();
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
};

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
  otelTrace: {
    getActiveSpan: vi.fn(() => ({
      setAttribute,
      setAttributes,
    })),
  },
}));

describe('autotel-audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forceKeepAuditEvent sets tail keep attributes', () => {
    forceKeepAuditEvent(mockCtx as never);

    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.sampling.tail.evaluated',
      true,
    );
    expect(setAttribute).toHaveBeenCalledWith('autotel.sampling.tail.keep', true);
    expect(setAttribute).toHaveBeenCalledWith('autotel.audit.force_keep', true);
  });

  it('setAuditAttributes writes audit.* attributes', () => {
    const metadata: AuditMetadata = {
      action: 'user.delete',
      resource: 'account',
      actorId: 'admin-1',
    };

    setAuditAttributes(metadata, mockCtx as never);

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
