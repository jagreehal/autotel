import { describe, expect, it, vi } from 'vitest';
import {
  getRequestLogger,
  getQueueLogger,
  getWorkflowLogger,
  getActorLogger,
} from './execution-logger';

const createMockContext = () => ({
  traceId: 'trace-id',
  spanId: 'span-id',
  correlationId: 'corr-id',
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  recordException: vi.fn(),
  addEvent: vi.fn(),
  addLink: vi.fn(),
  addLinks: vi.fn(),
  updateName: vi.fn(),
  isRecording: vi.fn(() => true),
});

describe('cloudflare execution logger aliases', () => {
  it('getRequestLogger delegates to the shared execution logger', () => {
    const ctx = createMockContext();
    const log = getRequestLogger(ctx);

    log.set({ request: { id: 'req-123' } });

    expect(ctx.setAttributes).toHaveBeenCalledWith({
      'request.id': 'req-123',
    });
  });

  it('getQueueLogger delegates to the shared execution logger', () => {
    const ctx = createMockContext();
    const log = getQueueLogger(ctx);

    log.info('processing batch', { queue: { name: 'payments' } });

    expect(ctx.addEvent).toHaveBeenCalledWith('log.info', {
      message: 'processing batch',
      'queue.name': 'payments',
    });
  });

  it('getWorkflowLogger delegates to the shared execution logger', () => {
    const ctx = createMockContext();
    const log = getWorkflowLogger(ctx);
    const snapshot = log.emitNow({ workflow: { id: 'wf-123' } });

    expect(snapshot.traceId).toBe('trace-id');
    expect(ctx.addEvent).toHaveBeenCalledWith('log.emit.manual', {
      'workflow.id': 'wf-123',
    });
  });

  it('getActorLogger delegates to the shared execution logger', () => {
    const ctx = createMockContext();
    const log = getActorLogger(ctx);

    log.warn('alarm delayed', { actor: { class: 'Counter' } });

    expect(ctx.setAttribute).toHaveBeenCalledWith('autotel.log.level', 'warn');
    expect(ctx.addEvent).toHaveBeenCalledWith('log.warn', {
      message: 'alarm delayed',
      'actor.class': 'Counter',
    });
  });
});
