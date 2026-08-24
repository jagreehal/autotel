import { describe, expect, it, vi } from 'vitest';
import { DETECTION_ATTR } from './sequence.js';
import {
  DETECTION_DISPOSITION_ATTR,
  DETECTION_DISPOSITION_EVENT,
  recordDetectionDisposition,
} from './disposition.js';

function noopLogger() {
  return { info: () => {}, set: () => {}, setLevel: () => {} } as never;
}

function ctx() {
  const setAttributes = vi.fn();
  const addEvent = vi.fn();
  return {
    ctx: { setAttribute: vi.fn(), setAttributes, addEvent } as never,
    attrs: () => setAttributes.mock.calls.at(-1)?.[0] ?? {},
    events: () => addEvent.mock.calls,
  };
}

describe('recordDetectionDisposition', () => {
  it('records who decided what about which finding', () => {
    const { ctx: c, attrs } = ctx();
    recordDetectionDisposition({
      ctx: c,
      logger: noopLogger(),
      correlationId: 'sess-1',
      ruleId: 'denied-then-executed',
      status: 'acknowledged',
    });

    expect(attrs()[DETECTION_DISPOSITION_ATTR.correlationId]).toBe('sess-1');
    expect(attrs()[DETECTION_DISPOSITION_ATTR.ruleId]).toBe(
      'denied-then-executed',
    );
    expect(attrs()[DETECTION_DISPOSITION_ATTR.status]).toBe('acknowledged');
  });

  it('refuses to close a finding as a false positive without a reason', () => {
    // An unexplained dismissal is not a disposition. The sentence is the
    // difference between a control and a checkbox, so it is enforced here
    // rather than left to whoever builds the UI.
    const { ctx: c } = ctx();

    expect(() =>
      recordDetectionDisposition({
        ctx: c,
        logger: noopLogger(),
        correlationId: 'sess-1',
        ruleId: 'denied-then-executed',
        status: 'false_positive',
      }),
    ).toThrow(/note/i);
  });

  it('refuses to accept risk without a reason', () => {
    const { ctx: c } = ctx();

    expect(() =>
      recordDetectionDisposition({
        ctx: c,
        logger: noopLogger(),
        correlationId: 'sess-1',
        ruleId: 'denied-then-executed',
        status: 'risk_accepted',
        note: '   ',
      }),
    ).toThrow(/note/i);
  });

  it('accepts a closing status that carries its reason', () => {
    const { ctx: c, attrs } = ctx();
    recordDetectionDisposition({
      ctx: c,
      logger: noopLogger(),
      correlationId: 'sess-1',
      ruleId: 'denied-then-executed',
      status: 'risk_accepted',
      note: 'known internal test harness',
    });

    expect(attrs()[DETECTION_DISPOSITION_ATTR.status]).toBe('risk_accepted');
    expect(attrs()[DETECTION_DISPOSITION_ATTR.note]).toBe(
      'known internal test harness',
    );
  });

  it('does not require a reason for a status that leaves the finding open', () => {
    const { ctx: c, attrs } = ctx();
    recordDetectionDisposition({
      ctx: c,
      logger: noopLogger(),
      correlationId: 'sess-1',
      ruleId: 'denied-then-executed',
      status: 'in_progress',
    });

    expect(attrs()[DETECTION_DISPOSITION_ATTR.status]).toBe('in_progress');
  });

  it('records the superseded status so a reversal survives', () => {
    // "False positive" later becoming "confirmed" is the transition that
    // matters most. A disposition is appended, never edited, so both stand.
    const { ctx: c, attrs } = ctx();
    recordDetectionDisposition({
      ctx: c,
      logger: noopLogger(),
      correlationId: 'sess-1',
      ruleId: 'denied-then-executed',
      status: 'in_progress',
      supersedes: 'false_positive',
    });

    expect(attrs()[DETECTION_DISPOSITION_ATTR.supersedes]).toBe(
      'false_positive',
    );
  });
});

describe('recordDetectionDisposition history', () => {
  function logger() {
    const info = vi.fn();
    return {
      logger: { info, set: vi.fn(), setLevel: vi.fn() } as never,
      records: () => info.mock.calls,
    };
  }

  it('emits each decision as a correlated log record', () => {
    // Span events are not logs: LogQL cannot see them, and the repo's event
    // model says new instrumentation goes through the Logs API. One record per
    // decision is also what makes the history append-only — span attributes are
    // last-write-wins and would lose the earlier status.
    const { ctx: c } = ctx();
    const { logger: l, records } = logger();

    recordDetectionDisposition({
      ctx: c,
      logger: l,
      correlationId: 'sess-1',
      ruleId: 'r',
      status: 'false_positive',
      note: 'looked like a test harness',
    });
    recordDetectionDisposition({
      ctx: c,
      logger: l,
      correlationId: 'sess-1',
      ruleId: 'r',
      status: 'in_progress',
      supersedes: 'false_positive',
    });

    expect(records()).toHaveLength(2);
    expect(records()[0]?.[0]).toBe(DETECTION_DISPOSITION_EVENT);
    expect(records()[0]?.[1]).toMatchObject({
      [DETECTION_DISPOSITION_ATTR.status]: 'false_positive',
      [DETECTION_DISPOSITION_ATTR.note]: 'looked like a test harness',
    });
    expect(records()[1]?.[1]).toMatchObject({
      [DETECTION_DISPOSITION_ATTR.status]: 'in_progress',
      [DETECTION_DISPOSITION_ATTR.supersedes]: 'false_positive',
    });
  });

  it('keys every record by rule and correlation id', () => {
    // A disposition is normally recorded long after the detection, in a
    // different trace. Trace correlation cannot join them; these keys can.
    const { ctx: c } = ctx();
    const { logger: l, records } = logger();

    recordDetectionDisposition({
      ctx: c,
      logger: l,
      correlationId: 'sess-1',
      ruleId: 'denied-then-executed',
      status: 'acknowledged',
    });

    expect(records()[0]?.[1]).toMatchObject({
      [DETECTION_DISPOSITION_ATTR.correlationId]: 'sess-1',
      [DETECTION_DISPOSITION_ATTR.ruleId]: 'denied-then-executed',
    });
  });

  it('still leaves the latest status queryable as a span attribute', () => {
    const { ctx: c, attrs } = ctx();
    const { logger: l } = logger();
    recordDetectionDisposition({
      ctx: c,
      logger: l,
      correlationId: 'sess-1',
      ruleId: 'r',
      status: 'resolved',
    });

    expect(attrs()[DETECTION_DISPOSITION_ATTR.status]).toBe('resolved');
  });
});

describe('recordDetectionDisposition join keys', () => {
  it('uses the same keys a detection record carries', () => {
    // The whole point of the pair: a set difference over
    // (rule id, correlation id) is only possible if both sides spell them the
    // same way.
    expect(DETECTION_DISPOSITION_ATTR.ruleId).toBe(DETECTION_ATTR.ruleId);
    expect(DETECTION_DISPOSITION_ATTR.correlationId).toBe(
      DETECTION_ATTR.correlationId,
    );
  });
});

describe('recordDetectionDisposition logger resolution', () => {
  it('refuses to record when no logger can be resolved', () => {
    // An explicit ctx with no ambient request logger used to yield a no-op
    // logger: span attributes were updated and the append-only record — the
    // only durable half — was dropped without a word. For an audit record,
    // failing loudly is the only safe behaviour.
    const { ctx: c } = ctx();

    expect(() =>
      recordDetectionDisposition({
        ctx: c,
        correlationId: 'sess-1',
        ruleId: 'r',
        status: 'acknowledged',
      }),
    ).toThrow(/logger/i);
  });

  it('does not touch span attributes when it cannot record the decision', () => {
    // A span saying "resolved" with no record of who resolved it or why is
    // worse than no answer at all.
    const { ctx: c, attrs } = ctx();

    expect(() =>
      recordDetectionDisposition({
        ctx: c,
        correlationId: 'sess-1',
        ruleId: 'r',
        status: 'acknowledged',
      }),
    ).toThrow();
    expect(attrs()).toEqual({});
  });
});

describe('recordDetectionDisposition ordering', () => {
  it('does not write the record when the span context is missing', () => {
    // Writing first and resolving the context afterwards means a caller that
    // retries the throw records the decision twice. Duplicated history is worse
    // than none: it is indistinguishable from someone deciding twice.
    const info = vi.fn();

    expect(() =>
      recordDetectionDisposition({
        logger: { info, set: vi.fn(), setLevel: vi.fn() } as never,
        correlationId: 'sess-1',
        ruleId: 'r',
        status: 'acknowledged',
      }),
    ).toThrow();

    expect(info).not.toHaveBeenCalled();
  });

  it('writes exactly once when both dependencies resolve', () => {
    const info = vi.fn();
    const { ctx: c } = ctx();

    recordDetectionDisposition({
      ctx: c,
      logger: { info, set: vi.fn(), setLevel: vi.fn() } as never,
      correlationId: 'sess-1',
      ruleId: 'r',
      status: 'acknowledged',
    });

    expect(info).toHaveBeenCalledTimes(1);
  });
});
