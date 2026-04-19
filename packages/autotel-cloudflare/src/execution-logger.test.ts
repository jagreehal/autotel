import { describe, expect, it, vi } from 'vitest';
import {
  getRequestLogger,
  getQueueLogger,
  getWorkflowLogger,
  getActorLogger,
  createWorkersLogger,
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
    expect(typeof log.fork).toBe('function');
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
    const first = log.emitNow({ workflow: { id: 'wf-123' } });
    const second = log.emitNow({ workflow: { id: 'wf-123' } });

    expect(first.traceId).toBe('trace-id');
    expect(second).toBe(first);
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

  it('createWorkersLogger pre-populates request and cf context fields', () => {
    const ctx = createMockContext();
    const request = new Request('https://example.com/api/orders/123?expand=1', {
      method: 'POST',
      headers: {
        'cf-ray': 'ray-123',
        traceparent: '00-abc-def-01',
        authorization: 'Bearer should-not-include-by-default',
        'x-request-id': 'req-789',
      },
    });

    Object.defineProperty(request, 'cf', {
      value: {
        colo: 'LHR',
        country: 'GB',
        asn: 13335,
        city: 'London',
        region: 'England',
      },
    });

    const log = createWorkersLogger(request, { headers: ['x-request-id'] }, ctx);

    const fields = log.getContext();
    expect(fields.request).toMatchObject({
      method: 'POST',
      path: '/api/orders/123',
      url: 'https://example.com/api/orders/123?expand=1',
      requestId: 'ray-123',
      headers: { 'x-request-id': 'req-789' },
    });
    expect(fields.cfRay).toBe('ray-123');
    expect(fields.traceparent).toBe('00-abc-def-01');
    expect(fields.colo).toBe('LHR');
    expect(fields.country).toBe('GB');
    expect(fields.asn).toBe(13335);
  });

  it('createWorkersLogger honors explicit requestId override', () => {
    const ctx = createMockContext();
    const request = new Request('https://example.com/health', {
      headers: { 'cf-ray': 'ray-default' },
    });

    const log = createWorkersLogger(request, { requestId: 'manual-id' }, ctx);

    expect(log.getContext().request).toMatchObject({
      requestId: 'manual-id',
    });
  });
});
