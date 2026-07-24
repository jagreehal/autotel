import { describe, it, expect } from 'vitest';
import { isControlFlowSignal } from './control-flow';

describe('isControlFlowSignal', () => {
  it('detects a modern redirect() signal (Response with .options)', () => {
    // Shape produced by @tanstack/router-core redirect({ throw: true }).
    const redirect = new Response(null, { status: 307 });
    (redirect as { options?: unknown }).options = { to: '/login' };
    expect(isControlFlowSignal(redirect)).toBe(true);
  });

  it('detects a modern notFound() signal (object with isNotFound)', () => {
    expect(isControlFlowSignal({ isNotFound: true })).toBe(true);
  });

  it('detects legacy RedirectError / NotFoundError by name', () => {
    const redirect = Object.assign(new Error('Redirect'), {
      name: 'RedirectError',
    });
    const notFound = Object.assign(new Error('Not Found'), {
      name: 'NotFoundError',
    });
    expect(isControlFlowSignal(redirect)).toBe(true);
    expect(isControlFlowSignal(notFound)).toBe(true);
  });

  it('does not treat a plain Response without .options as a signal', () => {
    expect(isControlFlowSignal(new Response(null, { status: 302 }))).toBe(false);
  });

  it('does not treat a real application error as a signal', () => {
    expect(isControlFlowSignal(new Error('database exploded'))).toBe(false);
    expect(isControlFlowSignal({ message: 'nope' })).toBe(false);
    expect(isControlFlowSignal('a string')).toBe(false);
    expect(isControlFlowSignal(null)).toBe(false);
    expect(isControlFlowSignal(undefined)).toBe(false);
  });
});
