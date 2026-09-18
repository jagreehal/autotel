// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';
import { context, trace, TraceFlags } from '@opentelemetry/api';
import { createSessionRatioSampler, withoutResourceFetch } from './sampler';
import { configureSession, resetSessionForTesting } from './session';

const traceId = (n: number) => n.toString(16).padStart(32, '0');

function decide(
  sampler: ReturnType<typeof createSessionRatioSampler>,
  id: string,
) {
  return sampler.shouldSample(
    undefined as never,
    id,
    'span',
    0 as never,
    {},
    [],
  ).decision;
}

beforeEach(() => resetSessionForTesting());
afterEach(() => resetSessionForTesting());

describe('session-consistent sampling', () => {
  it('keeps everything at 1', () => {
    const sampler = createSessionRatioSampler(1);
    expect(decide(sampler, traceId(1))).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it('keeps nothing at 0', () => {
    const sampler = createSessionRatioSampler(0);
    expect(decide(sampler, traceId(1))).toBe(SamplingDecision.NOT_RECORD);
  });

  it('gives every span in a session the same answer', () => {
    // The whole point: a sampled session is sampled whole, so what survives can
    // actually be reconstructed instead of being a tenth of every visit.
    configureSession({ id: () => 'session-consistent' });
    const sampler = createSessionRatioSampler(0.5);
    const first = decide(sampler, traceId(1));
    for (let i = 2; i < 40; i++) {
      expect(decide(sampler, traceId(i))).toBe(first);
    }
  });

  it('splits different sessions', () => {
    const sampler = createSessionRatioSampler(0.5);
    const decisions = new Set<SamplingDecision>();
    for (let i = 0; i < 200; i++) {
      configureSession({ id: () => `session-${i}` });
      decisions.add(decide(sampler, traceId(i)));
    }
    expect(decisions.size).toBe(2);
  });

  it('falls back to the trace id when there is no session', () => {
    configureSession(false);
    const sampler = createSessionRatioSampler(0.5);
    const first = decide(sampler, traceId(7));
    expect(decide(sampler, traceId(7))).toBe(first);
  });

  it('describes itself for debugging', () => {
    expect(createSessionRatioSampler(0.25).toString()).toContain('0.25');
  });
});

describe('withoutResourceFetch', () => {
  it('respects an unsampled parent when no inner sampler is given', () => {
    // The provider default is parent-based always-on; the filter must not
    // turn an unsampled parent's children into sampled ones.
    const parent = trace.setSpanContext(context.active(), {
      traceId: traceId(9),
      spanId: '0000000000000001',
      traceFlags: TraceFlags.NONE,
    });
    const sampler = withoutResourceFetch();
    expect(
      sampler.shouldSample(parent, traceId(9), 'child', 0 as never, {}, [])
        .decision,
    ).toBe(SamplingDecision.NOT_RECORD);
    expect(
      sampler.shouldSample(
        context.active(),
        traceId(9),
        'root',
        0 as never,
        {},
        [],
      ).decision,
    ).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });
});
