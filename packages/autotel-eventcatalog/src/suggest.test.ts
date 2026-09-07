import { describe, expect, it } from 'vitest';
import { describeSuggestion, suggestRenames } from './suggest';
import type { DriftReport } from './diff';

function report(
  observedButUndocumented: string[],
  documentedButUnseen: string[],
): DriftReport {
  return {
    snapshotGeneratedAt: '2026-09-07T00:00:00.000Z',
    snapshotService: 'shop',
    events: {
      observedButUndocumented,
      documentedButUnseen,
      fieldDrift: [],
      typeDrift: [],
      valueDrift: [],
    },
    services: { observedButUndocumented: [] },
    channels: { observedButUndocumented: [] },
  };
}

describe('suggestRenames', () => {
  /** The failure this exists for: one rename reported as two problems. */
  it('pairs a renamed event instead of leaving two unrelated findings', () => {
    const [suggestion] = suggestRenames(
      report(['payment.captured'], ['PaymentCapture']),
    );

    expect(suggestion?.observed).toBe('payment.captured');
    expect(suggestion?.documented).toBe('PaymentCapture');
    expect(suggestion?.confidence).toBe('likely');
  });

  it('stays quiet when the names are genuinely unrelated', () => {
    expect(
      suggestRenames(report(['order.cancelled'], ['RecommendationGenerated'])),
    ).toEqual([]);
  });

  /**
   * A suggestion is a question, not a fact. Two undocumented events cannot both
   * be the same rename, and offering both would send someone to rename one
   * thing twice.
   */
  it('uses each side at most once, best match first', () => {
    const suggestions = suggestRenames(
      report(['payment.captured', 'payment.capture.v2'], ['PaymentCaptured']),
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.observed).toBe('payment.captured');
  });

  it('grades a weaker match as possible rather than likely', () => {
    const [suggestion] = suggestRenames(
      report(['order.placed'], ['OrdersPlacedEvent']),
    );
    expect(suggestion?.confidence).toBe('possible');
  });

  it('returns nothing when either side of the pairing is empty', () => {
    expect(suggestRenames(report(['a.b'], []))).toEqual([]);
    expect(suggestRenames(report([], ['AB']))).toEqual([]);
  });

  it('is stable across runs, so a report diff stays clean', () => {
    const input = report(
      ['payment.captured', 'order.cancelled'],
      ['PaymentCapture', 'OrderCancel'],
    );
    expect(JSON.stringify(suggestRenames(input))).toBe(
      JSON.stringify(suggestRenames(input)),
    );
  });

  it('describes the next action, not just the similarity', () => {
    const [suggestion] = suggestRenames(
      report(['payment.captured'], ['PaymentCapture']),
    );
    const line = describeSuggestion(suggestion!);
    expect(line).toContain('payment.captured');
    expect(line).toContain('PaymentCapture');
    expect(line).toMatch(/rename one side/);
  });
});
