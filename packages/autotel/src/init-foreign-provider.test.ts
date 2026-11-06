import { context, propagation, trace } from '@opentelemetry/api';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from './init';
import { shutdown } from './shutdown';

const lostProvider = expect.stringContaining('already registered');

describe('init() when another tracer provider holds the global', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    warn.mockClear();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  afterEach(async () => {
    await shutdown();
    trace.disable();
  });

  it('warns, because none of its spans will be exported', () => {
    trace.setGlobalTracerProvider(new TracerProvider());
    init({ service: 'test' });
    expect(warn).toHaveBeenCalledWith(lostProvider);
  });

  it('stays quiet when silent', () => {
    trace.setGlobalTracerProvider(new TracerProvider());
    init({ service: 'test', silent: true });
    expect(warn).not.toHaveBeenCalledWith(lostProvider);
  });

  it('does not warn when it registers, or re-registers, its own', () => {
    init({ service: 'test' });
    init({ service: 'test' });
    expect(warn).not.toHaveBeenCalledWith(lostProvider);
  });
});
