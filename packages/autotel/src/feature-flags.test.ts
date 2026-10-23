import { describe, expect, it, vi } from 'vitest';
import {
  autotelOpenFeatureHook,
  FEATURE_FLAG,
  FEATURE_FLAG_EVALUATION_EVENT,
  featureFlagAttributes,
  recordFeatureFlag,
} from './feature-flags';

describe('canonical feature flag names', () => {
  it('pins the specification keys', () => {
    expect(FEATURE_FLAG).toEqual({
      KEY: 'feature_flag.key',
      RESULT_VALUE: 'feature_flag.result.value',
      RESULT_VARIANT: 'feature_flag.result.variant',
      RESULT_REASON: 'feature_flag.result.reason',
      PROVIDER_NAME: 'feature_flag.provider.name',
      CONTEXT_ID: 'feature_flag.context.id',
      SET_ID: 'feature_flag.set.id',
      VERSION: 'feature_flag.version',
      // `feature_flag.evaluation.error.message` is deprecated in favour of this.
      ERROR_MESSAGE: 'feature_flag.error.message',
      ERROR_TYPE: 'error.type',
    });
    expect(FEATURE_FLAG_EVALUATION_EVENT).toBe('feature_flag.evaluation');
  });
});

describe('featureFlagAttributes', () => {
  it('maps an evaluation onto canonical keys', () => {
    expect(
      featureFlagAttributes({
        key: 'new-checkout',
        value: true,
        variant: 'treatment',
        reason: 'TARGETING_MATCH',
        provider: 'posthog',
        contextId: 'user-42',
      }),
    ).toEqual({
      'feature_flag.key': 'new-checkout',
      'feature_flag.result.variant': 'treatment',
      'feature_flag.result.reason': 'targeting_match',
      'feature_flag.provider.name': 'posthog',
      'feature_flag.context.id': 'user-42',
    });
  });

  it('records the value beside a variant only when asked', () => {
    // Typed, not stringified: the attribute permits a boolean, and turning
    // one into "true" makes it uncomparable with a numeric or boolean flag.
    expect(
      featureFlagAttributes(
        { key: 'k', value: true, variant: 'on' },
        { includeValue: true },
      )['feature_flag.result.value'],
    ).toBe(true);
  });

  it('keeps numbers as numbers', () => {
    expect(
      featureFlagAttributes({ key: 'max-items', value: 25 })[
        'feature_flag.result.value'
      ],
    ).toBe(25);
  });

  it('serialises a structured value, which no attribute type can hold', () => {
    expect(
      featureFlagAttributes({ key: 'limits', value: { max: 5 } })[
        'feature_flag.result.value'
      ],
    ).toBe('{"max":5}');
  });

  it('omits what was not supplied', () => {
    expect(featureFlagAttributes({ key: 'k', value: false })).toEqual({
      'feature_flag.key': 'k',
      'feature_flag.result.value': false,
    });
  });

  it('records an evaluation error under the current attribute', () => {
    expect(
      featureFlagAttributes({
        key: 'k',
        value: false,
        errorMessage: 'timeout',
      }),
    ).toMatchObject({
      'feature_flag.error.message': 'timeout',
      'error.type': 'general',
    });
  });

  it('lower-cases an error type to the registry spelling', () => {
    expect(
      featureFlagAttributes({
        key: 'k',
        value: false,
        errorType: 'FLAG_NOT_FOUND',
      })['error.type'],
    ).toBe('flag_not_found');
  });
});

describe('recordFeatureFlag', () => {
  it('puts the evaluation on the span that branched on it', () => {
    const setAttributes = vi.fn();
    recordFeatureFlag(
      { setAttributes, track: vi.fn() },
      { key: 'new-checkout', value: true, variant: 'treatment' },
    );
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'feature_flag.key': 'new-checkout' }),
    );
  });

  it('emits the evaluation as a correlated log event', () => {
    // The repository emits events through the Logs API model. `track` is the
    // only seam offered — `Span.addEvent` is not a fallback here, because a
    // fallback is how a direction becomes optional.
    const track = vi.fn();
    recordFeatureFlag(
      { setAttributes: vi.fn(), track },
      { key: 'a', value: true },
    );
    expect(track).toHaveBeenCalledWith(
      'feature_flag.evaluation',
      expect.objectContaining({ 'feature_flag.key': 'a' }),
    );
  });

  it('emits one event per flag so several can coexist on a span', () => {
    // Attributes hold one flag; a request that branched on three needs an event
    // each, or the second overwrites the first.
    const track = vi.fn();
    const span = { setAttributes: vi.fn(), track };
    recordFeatureFlag(span, { key: 'a', value: true });
    recordFeatureFlag(span, { key: 'b', value: false });
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('records attributes even with no event seam at all', () => {
    const setAttributes = vi.fn();
    expect(() =>
      recordFeatureFlag({ setAttributes }, { key: 'k', value: true }),
    ).not.toThrow();
    expect(setAttributes).toHaveBeenCalled();
  });

  it('normalises the reason to the canonical lower-case value', () => {
    // OpenFeature reports TARGETING_MATCH; the registry defines
    // `targeting_match`. Forwarding the provider's casing splits every
    // group-by into two buckets that mean the same thing.
    expect(
      featureFlagAttributes({
        key: 'k',
        value: true,
        reason: 'TARGETING_MATCH',
      })['feature_flag.result.reason'],
    ).toBe('targeting_match');
  });

  it('passes an unknown reason through unchanged apart from case', () => {
    expect(
      featureFlagAttributes({
        key: 'k',
        value: true,
        reason: 'Provider_Quirk',
      })['feature_flag.result.reason'],
    ).toBe('provider_quirk');
  });

  it('does nothing without a span rather than throwing', () => {
    expect(() =>
      recordFeatureFlag(undefined, { key: 'k', value: true }),
    ).not.toThrow();
  });
});

describe('the span projection', () => {
  const rawSpan = (spanId: string) => ({
    setAttributes: vi.fn(),
    spanContext: () => ({ traceId: 't', spanId }),
  });

  it('keeps a long-running span unmixed however many others record flags', () => {
    const longRunning = rawSpan('long');
    recordFeatureFlag(longRunning, { key: 'first', value: 'x' });
    for (let index = 0; index < 10_001; index++) {
      recordFeatureFlag(rawSpan(`busy-${index}`), { key: 'k', value: true });
    }
    recordFeatureFlag(longRunning, { key: 'second', value: 'y' });

    expect(longRunning.setAttributes).toHaveBeenCalledTimes(1);
  });
});

describe('autotelOpenFeatureHook', () => {
  // OpenFeature merges a fresh evaluation context for every evaluation.
  const hookContext = () => ({
    flagKey: 'new-checkout',
    defaultValue: false,
    context: { targetingKey: 'user-42' },
    providerMetadata: { name: 'posthog' },
  });

  it('records an evaluation onto the active span', () => {
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    autotelOpenFeatureHook({ getSpan: () => span }).after?.(hookContext(), {
      value: true,
      variant: 'treatment',
      reason: 'TARGETING_MATCH',
    });

    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'feature_flag.key': 'new-checkout',
        'feature_flag.result.variant': 'treatment',
        'feature_flag.result.reason': 'targeting_match',
        'feature_flag.provider.name': 'posthog',
        'feature_flag.context.id': 'user-42',
      }),
    );
  });

  it('records a failed evaluation with the default that was used', () => {
    // The default is what the code actually branched on, so it is the value
    // worth recording — the failure is the reason, not the result.
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    autotelOpenFeatureHook({ getSpan: () => span }).error?.(
      hookContext(),
      new Error('provider timeout'),
    );

    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'feature_flag.result.value': false,
        'feature_flag.result.reason': 'error',
        'feature_flag.error.message': 'provider timeout',
      }),
    );
    expect(span.track).toHaveBeenCalledWith(
      'feature_flag.evaluation',
      expect.objectContaining({ 'error.type': 'general' }),
    );
  });

  it("records OpenFeature's error code as error.type", () => {
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    const error = Object.assign(new Error('no such flag'), {
      code: 'FLAG_NOT_FOUND',
    });
    autotelOpenFeatureHook({ getSpan: () => span }).error?.(
      hookContext(),
      error,
    );
    // On the event only: on the span, `error.type` would say the span's own
    // operation failed.
    expect(span.track).toHaveBeenCalledWith(
      'feature_flag.evaluation',
      expect.objectContaining({ 'error.type': 'flag_not_found' }),
    );
    expect(span.setAttributes.mock.calls[0]?.[0]).not.toHaveProperty(
      'error.type',
    );
  });

  it('keeps the first evaluation on the span, unmixed, and every one as an event', () => {
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    const hook = autotelOpenFeatureHook({ getSpan: () => span });
    hook.after?.(hookContext(), { value: 'blue' });
    hook.after?.(
      { ...hookContext(), flagKey: 'other' },
      { value: 'red', variant: 'treatment' },
    );

    expect(span.setAttributes).toHaveBeenCalledTimes(1);
    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'feature_flag.key': 'new-checkout',
        'feature_flag.result.value': 'blue',
      }),
    );
    expect(span.track.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ 'feature_flag.key': 'new-checkout' }),
      expect.objectContaining({
        'feature_flag.key': 'other',
        'feature_flag.result.variant': 'treatment',
      }),
    ]);
    expect(span.track.mock.calls[1]?.[1]).not.toHaveProperty(
      'feature_flag.result.value',
    );
  });

  it('keeps the value beside a variant when includeValue is set', () => {
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    autotelOpenFeatureHook({ getSpan: () => span, includeValue: true }).after?.(
      hookContext(),
      { value: 'blue', variant: 'treatment' },
    );
    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'feature_flag.result.value': 'blue' }),
    );
  });

  it('reads the flag set id and version from flag metadata', () => {
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    autotelOpenFeatureHook({ getSpan: () => span }).after?.(hookContext(), {
      value: true,
      flagMetadata: { flagSetId: 'proj-1', version: 3 },
    });
    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'feature_flag.set.id': 'proj-1',
        'feature_flag.version': '3',
      }),
    );
  });

  it('does nothing outside a span rather than throwing', () => {
    // The default path, with nothing active to record onto — which is the real
    // shape of the problem: a flag read outside any span is legitimate.
    const hook = autotelOpenFeatureHook();
    expect(() => hook.after?.(hookContext(), { value: true })).not.toThrow();
    expect(() => hook.error?.(hookContext(), new Error('x'))).not.toThrow();
  });

  it('reads the targeting key from a context that has no targetingKey', () => {
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    autotelOpenFeatureHook({ getSpan: () => span }).after?.(
      { ...hookContext(), context: {} },
      { value: true },
    );
    const attrs = span.setAttributes.mock.calls[0]?.[0] ?? {};
    expect(attrs['feature_flag.context.id']).toBeUndefined();
  });
});

describe('the default path emits a Logs API record', () => {
  const flag = (key: string) => ({
    flagKey: key,
    defaultValue: false,
    providerMetadata: { name: 'p' },
  });

  it('emits a log record, never a span event', () => {
    // A span event is invisible to log and event pipelines, which is the whole
    // reason this repository emits through the Logs API. `Span.addEvent` must
    // not be reached, directly or through a helper that prefers it.
    const emit = vi.fn();
    const addEvent = vi.fn();
    const hook = autotelOpenFeatureHook({
      getSpan: () => ({ setAttributes: vi.fn(), addEvent }) as never,
      emitLogRecord: emit,
    });

    hook.after?.(flag('a'), { value: true });
    hook.after?.(flag('b'), { value: false });

    expect(addEvent).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map((c) => c[0]['feature_flag.key'])).toEqual([
      'a',
      'b',
    ]);
  });

  it('emits a record even with no active span at all', () => {
    // The evaluation still happened, and a flag read outside a span is normal.
    const emit = vi.fn();
    // No span at all — the default `getSpan` finds none outside a trace.
    autotelOpenFeatureHook({ emitLogRecord: emit }).after?.(flag('a'), {
      value: true,
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('keeps a caller-supplied track in preference to the default', () => {
    const track = vi.fn();
    const emit = vi.fn();
    autotelOpenFeatureHook({
      getSpan: () => ({ setAttributes: vi.fn(), track }) as never,
      emitLogRecord: emit,
    }).after?.(flag('a'), { value: true });
    expect(track).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it('records a failed evaluation as a log record too', () => {
    const emit = vi.fn();
    autotelOpenFeatureHook({
      getSpan: () => ({ setAttributes: vi.fn() }) as never,
      emitLogRecord: emit,
    }).error?.(flag('a'), new Error('provider timeout'));
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        'feature_flag.error.message': 'provider timeout',
      }),
    );
  });
});
