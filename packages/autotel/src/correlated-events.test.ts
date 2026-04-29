import { describe, it, expect, vi } from 'vitest';
import {
  emitCorrelatedEvent,
  type CorrelatedEventTarget,
} from './correlated-events';

function makeTarget(opts: { withAddEvent: boolean }): {
  target: CorrelatedEventTarget;
  setAttribute: ReturnType<typeof vi.fn>;
  setAttributes: ReturnType<typeof vi.fn>;
  addEvent: ReturnType<typeof vi.fn> | undefined;
} {
  const setAttribute = vi.fn();
  const setAttributes = vi.fn();
  const addEvent = opts.withAddEvent ? vi.fn() : undefined;
  const target: CorrelatedEventTarget = addEvent
    ? { setAttribute, setAttributes, addEvent }
    : { setAttribute, setAttributes };
  return { target, setAttribute, setAttributes, addEvent };
}

describe('emitCorrelatedEvent', () => {
  describe('addEvent path', () => {
    it('forwards to addEvent when present and skips the attribute fallback', () => {
      const { target, setAttribute, setAttributes, addEvent } = makeTarget({
        withAddEvent: true,
      });

      emitCorrelatedEvent(target, 'gen_ai.prompt.sent', {
        'gen_ai.system': 'openai',
      });

      expect(addEvent).toHaveBeenCalledTimes(1);
      expect(addEvent).toHaveBeenCalledWith('gen_ai.prompt.sent', {
        'gen_ai.system': 'openai',
      });
      expect(setAttribute).not.toHaveBeenCalled();
      expect(setAttributes).not.toHaveBeenCalled();
    });

    it('sanitizes the event name before forwarding', () => {
      const { target, addEvent } = makeTarget({ withAddEvent: true });

      emitCorrelatedEvent(target, 'gen ai/prompt sent!', {});

      expect(addEvent).toHaveBeenCalledWith('gen_ai_prompt_sent_', {});
    });

    it('preserves `this` when calling addEvent (works for prototype methods)', () => {
      const captured: { self: unknown; args: unknown[] } = {
        self: null,
        args: [],
      };
      const target = {
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        addEvent(this: unknown, ...args: unknown[]) {
          captured.self = this;
          captured.args = args;
        },
      };

      emitCorrelatedEvent(target, 'evt', { k: 'v' });

      expect(captured.self).toBe(target);
      expect(captured.args).toEqual(['evt', { k: 'v' }]);
    });
  });

  describe('attribute fallback', () => {
    it('writes flat, sequence-prefixed attributes when addEvent is missing', () => {
      const { target, setAttributes } = makeTarget({ withAddEvent: false });

      emitCorrelatedEvent(target, 'workflow.started', {
        'workflow.id': 'wf-1',
      });

      expect(setAttributes).toHaveBeenCalledTimes(1);
      const written = setAttributes.mock.calls[0]![0] as Record<
        string,
        unknown
      >;

      expect(written['autotel.event.1.workflow.started.name']).toBe(
        'workflow.started',
      );
      expect(typeof written['autotel.event.1.workflow.started.ts']).toBe(
        'string',
      );
      expect(written['autotel.event.1.workflow.started.workflow.id']).toBe(
        'wf-1',
      );
    });

    it('does not overwrite earlier events when the same name fires twice', () => {
      const { target, setAttributes } = makeTarget({ withAddEvent: false });

      emitCorrelatedEvent(target, 'step_retry', { 'workflow.step.attempt': 1 });
      emitCorrelatedEvent(target, 'step_retry', { 'workflow.step.attempt': 2 });

      expect(setAttributes).toHaveBeenCalledTimes(2);
      const first = setAttributes.mock.calls[0]![0] as Record<string, unknown>;
      const second = setAttributes.mock.calls[1]![0] as Record<string, unknown>;

      expect(first['autotel.event.1.step_retry.workflow.step.attempt']).toBe(1);
      expect(second['autotel.event.2.step_retry.workflow.step.attempt']).toBe(
        2,
      );

      // Different keys: second call cannot overwrite the first when both
      // attribute sets are merged on the same span.
      expect(
        Object.keys(first).every((k) => !Object.keys(second).includes(k)),
      ).toBe(true);
    });

    it('sanitizes attribute keys in the fallback path', () => {
      const { target, setAttributes } = makeTarget({ withAddEvent: false });

      emitCorrelatedEvent(target, 'evt', { 'has spaces/and-bad!': 1 });

      const written = setAttributes.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      const key = Object.keys(written).find((k) =>
        k.endsWith('has_spaces_and-bad_'),
      );
      expect(key).toBeDefined();
      expect(written[key!]).toBe(1);
    });

    it('keeps separate sequences for separate targets', () => {
      const a = makeTarget({ withAddEvent: false });
      const b = makeTarget({ withAddEvent: false });

      emitCorrelatedEvent(a.target, 'evt', {});
      emitCorrelatedEvent(b.target, 'evt', {});

      const aKeys = Object.keys(
        a.setAttributes.mock.calls[0]![0] as Record<string, unknown>,
      );
      const bKeys = Object.keys(
        b.setAttributes.mock.calls[0]![0] as Record<string, unknown>,
      );

      expect(aKeys.some((k) => k.startsWith('autotel.event.1.'))).toBe(true);
      expect(bKeys.some((k) => k.startsWith('autotel.event.1.'))).toBe(true);
    });
  });
});
