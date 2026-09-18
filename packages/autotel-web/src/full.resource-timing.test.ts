// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import type {
  ReadableSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { initFull, resetFullForTesting } from './full';

afterEach(() => {
  resetFullForTesting();
  vi.unstubAllEnvs();
});

function recorder(): SpanProcessor & { seen: ReadableSpan[] } {
  const seen: ReadableSpan[] = [];
  return {
    seen,
    onStart() {},
    onEnd(s) {
      seen.push(s);
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

// Document-load instrumentation starts one `resourceFetch` span per resource
// on the page, so the test starts spans by that name the same way it would.
function loadPage() {
  const tracer = trace.getTracer('document-load');
  for (const name of [
    'documentFetch',
    'resourceFetch',
    'resourceFetch',
    'documentLoad',
  ]) {
    tracer.startSpan(name).end();
  }
}

const names = (r: { seen: ReadableSpan[] }) => r.seen.map((s) => s.name);

describe('captureResourceTiming', () => {
  it('keeps resourceFetch spans in production by default', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const seen = recorder();
    initFull({ service: 'web', spanProcessor: seen });

    loadPage();

    expect(names(seen)).toEqual([
      'documentFetch',
      'resourceFetch',
      'resourceFetch',
      'documentLoad',
    ]);
  });

  it('drops resourceFetch spans in development by default', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const seen = recorder();
    initFull({ service: 'web', spanProcessor: seen });

    loadPage();

    expect(names(seen)).toEqual(['documentFetch', 'documentLoad']);
  });

  it('an explicit true keeps them in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const seen = recorder();
    initFull({
      service: 'web',
      spanProcessor: seen,
      captureResourceTiming: true,
    });

    loadPage();

    expect(names(seen)).toContain('resourceFetch');
  });

  it('an explicit false drops them in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const seen = recorder();
    initFull({
      service: 'web',
      spanProcessor: seen,
      captureResourceTiming: false,
    });

    loadPage();

    expect(names(seen)).toEqual(['documentFetch', 'documentLoad']);
  });

  it('still honours the configured sampler for every other span', () => {
    const seen = recorder();
    initFull({
      service: 'web',
      spanProcessor: seen,
      captureResourceTiming: false,
      sampleRate: 0,
    });

    loadPage();

    expect(seen.seen).toEqual([]);
  });
});
