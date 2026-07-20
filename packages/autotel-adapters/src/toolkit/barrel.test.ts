import { describe, expect, it } from 'vitest';
import * as toolkit from './index';

describe('toolkit API surface', () => {
  it('exports integration helpers', () => {
    expect(toolkit.defineFrameworkIntegration).toBeTypeOf('function');
    expect(toolkit.createMiddlewareLogger).toBeTypeOf('function');
    expect(toolkit.extendDeferredDrain).toBeTypeOf('function');
    expect(toolkit.attachForkToLogger).toBeTypeOf('function');
    expect(toolkit.shouldDeferEmitForResponse).toBeTypeOf('function');
  });
});
