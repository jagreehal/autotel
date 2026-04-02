import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpanSearch } from '../components/SpanSearch';
import { signal } from '@preact/signals';
import { h } from 'preact';
import { render, fireEvent, screen, waitFor } from '@testing-library/preact';
import type { SpanData } from '../types';

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
    traceId: overrides.traceId ?? 'trace-1',
    spanId: overrides.spanId ?? 'span-1',
    name: overrides.name ?? 'GET /api/users',
    kind: overrides.kind ?? 'SERVER',
    startTime: overrides.startTime ?? Date.now(),
    endTime: overrides.endTime ?? Date.now() + 100,
    duration: overrides.duration ?? 100,
    attributes: overrides.attributes ?? {},
    status: overrides.status ?? { code: 'OK' },
    events: overrides.events ?? [],
    parentSpanId: overrides.parentSpanId,
  };
}

describe('SpanSearch with debounce', () => {
  it('debounces search input with 300ms default', async () => {
    const onMatchesChange = vi.fn();
    const onCurrentMatchChange = vi.fn();
    const spans = [
      makeSpan({ spanId: 's1', name: 'GET /api/users' }),
      makeSpan({ spanId: 's2', name: 'POST /api/orders' }),
    ];

    render(h(SpanSearch, { spans, onMatchesChange, onCurrentMatchChange }));

    const input = screen.getByPlaceholderText(/search spans/i);

    // Type quickly
    fireEvent.input(input, { target: { value: 'GET' } });
    fireEvent.input(input, { target: { value: 'GET /' } });
    fireEvent.input(input, { target: { value: 'GET /api' } });

    // Should not have called yet
    expect(onMatchesChange).not.toHaveBeenCalled();

    // Wait for debounce
    await waitFor(
      () => {
        expect(onMatchesChange).toHaveBeenCalled();
      },
      { timeout: 400 },
    );

    // Should only be called once despite multiple inputs
    expect(onMatchesChange).toHaveBeenCalledTimes(1);

    // Should find the matching span
    expect(onMatchesChange).toHaveBeenCalledWith(new Set(['s1']));
  });

  it('supports custom debounce duration', async () => {
    const onMatchesChange = vi.fn();
    const spans = [makeSpan({ spanId: 's1', name: 'test span' })];

    render(
      h(SpanSearch, {
        spans,
        onMatchesChange,
        onCurrentMatchChange: vi.fn(),
        debounceMs: 100,
      }),
    );

    const input = screen.getByPlaceholderText(/search spans/i);
    fireEvent.input(input, { target: { value: 'test' } });

    // Should debounce for 100ms
    await waitFor(
      () => {
        expect(onMatchesChange).toHaveBeenCalled();
      },
      { timeout: 200 },
    );
  });

  it('clears matches when query is empty', async () => {
    const onMatchesChange = vi.fn();
    const spans = [makeSpan({ spanId: 's1', name: 'test' })];

    render(
      h(SpanSearch, { spans, onMatchesChange, onCurrentMatchChange: vi.fn() }),
    );

    const input = screen.getByPlaceholderText(/search spans/i);

    // Search
    fireEvent.input(input, { target: { value: 'test' } });
    await waitFor(() => expect(onMatchesChange).toHaveBeenCalled());

    // Clear
    vi.clearAllMocks();
    fireEvent.input(input, { target: { value: '' } });

    // Should immediately clear (no debounce for empty)
    expect(onMatchesChange).toHaveBeenCalledWith(new Set());
  });

  it('searches span attributes', async () => {
    const onMatchesChange = vi.fn();
    const spans = [
      makeSpan({
        spanId: 's1',
        attributes: { 'http.method': 'GET', 'user.id': '123' },
      }),
      makeSpan({ spanId: 's2', attributes: { 'http.method': 'POST' } }),
    ];

    render(
      h(SpanSearch, { spans, onMatchesChange, onCurrentMatchChange: vi.fn() }),
    );

    const input = screen.getByPlaceholderText(/search spans/i);
    fireEvent.input(input, { target: { value: 'user.id' } });

    await waitFor(
      () => {
        expect(onMatchesChange).toHaveBeenCalled();
      },
      { timeout: 400 },
    );

    // Should find the span with matching attribute
    expect(onMatchesChange).toHaveBeenCalledWith(new Set(['s1']));
  });

  it('exposes debounce timing for testing', () => {
    vi.useFakeTimers();

    const onMatchesChange = vi.fn();
    const spans = [makeSpan()];

    render(
      h(SpanSearch, {
        spans,
        onMatchesChange,
        onCurrentMatchChange: vi.fn(),
        debounceMs: 500,
      }),
    );

    const input = screen.getByPlaceholderText(/search spans/i);
    fireEvent.input(input, { target: { value: 'test' } });

    // Advance timers
    vi.advanceTimersByTime(250);
    expect(onMatchesChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(onMatchesChange).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
