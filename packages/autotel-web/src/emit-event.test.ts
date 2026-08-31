import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emitEvent,
  resetEventSinkForTesting,
  setEventSink,
} from './emit-event';

afterEach(() => resetEventSinkForTesting());

describe('emitEvent', () => {
  it('hands the event to the configured sink', () => {
    const sink = vi.fn();
    setEventSink(sink);
    emitEvent('browser.web_vital', { 'browser.web_vital.name': 'lcp' });
    expect(sink).toHaveBeenCalledWith('browser.web_vital', {
      'browser.web_vital.name': 'lcp',
    });
  });

  it('is a no-op with no sink, rather than throwing', () => {
    expect(() => emitEvent('app.jank', {})).not.toThrow();
  });

  it('never lets a failing sink reach the caller', () => {
    // An event is a description of something the application did. It must not
    // become the reason that thing fails.
    setEventSink(() => {
      throw new Error('exporter exploded');
    });
    expect(() => emitEvent('app.widget.click', {})).not.toThrow();
  });

  it('can be unset', () => {
    const sink = vi.fn();
    setEventSink(sink);
    setEventSink(undefined);
    emitEvent('app.jank', {});
    expect(sink).not.toHaveBeenCalled();
  });
});
