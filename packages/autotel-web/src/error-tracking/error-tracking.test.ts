// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import { setupErrorTracking, captureException, resetErrorTrackingForTesting } from './index';

const mockRecordException = vi.fn();
const mockSetStatus = vi.fn();
const mockSetAttribute = vi.fn();
const mockAddEvent = vi.fn();
const mockEnd = vi.fn();

const mockSpan = {
  recordException: mockRecordException,
  setStatus: mockSetStatus,
  setAttribute: mockSetAttribute,
  addEvent: mockAddEvent,
  end: mockEnd,
  isRecording: () => true,
};

const mockStartActiveSpan = vi.fn((name: string, fn: (span: any) => any) => fn(mockSpan));
const mockTracer = {
  startActiveSpan: mockStartActiveSpan,
};

vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);
vi.spyOn(trace, 'getActiveSpan').mockReturnValue(null);

describe('setupErrorTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetErrorTrackingForTesting();
  });

  it('captures window error events', () => {
    setupErrorTracking({ debug: false });

    const error = new TypeError('test error');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'test error' }));

    expect(mockStartActiveSpan).toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('exception.type', 'TypeError');
    expect(mockSetAttribute).toHaveBeenCalledWith('exception.message', 'test error');
    expect(mockSetAttribute).toHaveBeenCalledWith('error.source', 'onerror');
  });

  it('captures unhandled rejection events', () => {
    setupErrorTracking({ debug: false });

    const error = new Error('rejected');
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: error,
      }),
    );

    expect(mockStartActiveSpan).toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('error.source', 'onunhandledrejection');
  });

  it('adds exception.list attribute with structured data', () => {
    setupErrorTracking({ debug: false });

    const error = new Error('structured test');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'structured test' }));

    expect(mockSetAttribute).toHaveBeenCalledWith('exception.list', expect.any(String));
    const call = mockSetAttribute.mock.calls.find((c: any) => c[0] === 'exception.list');
    const parsed = JSON.parse(call![1]);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed[0].type).toBe('Error');
  });

  it('rate-limits by exception type', () => {
    setupErrorTracking({
      debug: false,
      rateLimit: { maxPerType: 1, windowMs: 10000 },
    });

    const error1 = new TypeError('first');
    const error2 = new TypeError('second');
    window.dispatchEvent(new ErrorEvent('error', { error: error1, message: 'first' }));
    window.dispatchEvent(new ErrorEvent('error', { error: error2, message: 'second' }));

    expect(mockStartActiveSpan).toHaveBeenCalledTimes(1);
  });

  it('suppresses matching errors', () => {
    setupErrorTracking({
      debug: false,
      suppressionRules: [{ key: 'value', operator: 'contains', value: 'Script error' }],
    });

    const error = new Error('Script error.');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'Script error.' }));

    expect(mockStartActiveSpan).not.toHaveBeenCalled();
  });

  it('skips autocapture when window.posthog detected and deferToPostHog=true', () => {
    (globalThis as any).posthog = { captureException: vi.fn() };

    setupErrorTracking({ debug: false, deferToPostHog: true });

    // Add a temporary listener to prevent jsdom from treating the ErrorEvent as uncaught
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);

    const error = new Error('test');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'test', cancelable: true }));

    expect(mockStartActiveSpan).not.toHaveBeenCalled();

    window.removeEventListener('error', swallow);
    delete (globalThis as any).posthog;
  });

  it('still captures when deferToPostHog=false even if posthog exists', () => {
    (globalThis as any).posthog = { captureException: vi.fn() };

    setupErrorTracking({ debug: false, deferToPostHog: false });

    const error = new Error('test');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'test' }));

    expect(mockStartActiveSpan).toHaveBeenCalled();

    delete (globalThis as any).posthog;
  });
});

describe('captureException', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetErrorTrackingForTesting();
    setupErrorTracking({ debug: false });
  });

  it('manually captures an error', () => {
    captureException(new Error('manual'));

    expect(mockStartActiveSpan).toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('exception.type', 'Error');
    expect(mockSetAttribute).toHaveBeenCalledWith('exception.message', 'manual');
  });

  it('sets mechanism to manual with handled=true', () => {
    captureException(new Error('manual'));

    const call = mockSetAttribute.mock.calls.find((c: any) => c[0] === 'exception.list');
    const parsed = JSON.parse(call![1]);
    expect(parsed[0].mechanism.type).toBe('manual');
    expect(parsed[0].mechanism.handled).toBe(true);
  });
});
