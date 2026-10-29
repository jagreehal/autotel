import { SpanStatusCode, flush, init } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import type { Span } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { instrumentConsumerEvents } from './stream-events';

describe('instrumentConsumerEvents defaults', () => {
  it('records a span per event when given no lifecycle span', async () => {
    const exporter = createMemoryExporter();
    init({ service: 'consumer-events-test', spanExporters: [exporter] });
    const listeners = new Map<string, (event: unknown) => void>();

    instrumentConsumerEvents({
      on: (event, listener) => listeners.set(event, listener),
    });
    listeners.get('consumer.group_join')!({
      type: 'consumer.group_join',
      payload: { groupId: 'scoreboard', memberAssignment: { matches: [1] } },
    });
    await flush();

    expect(
      exporter.findSpan('kafka.consumer.consumer.group_join')?.attributes,
    ).toMatchObject({
      'messaging.kafka.consumer.group': 'scoreboard',
      'messaging.kafka.consumer.assignment_count': 1,
    });
  });

  it('records a clean disconnect as a normal lifecycle span', async () => {
    const exporter = createMemoryExporter();
    init({ service: 'consumer-events-test', spanExporters: [exporter] });
    const listeners = new Map<string, (event: unknown) => void>();

    instrumentConsumerEvents({
      on: (event, listener) => listeners.set(event, listener),
    });
    listeners.get('consumer.disconnect')!({
      type: 'consumer.disconnect',
      payload: {},
    });
    await flush();

    const disconnect = exporter.findSpan('kafka.consumer.consumer.disconnect');
    expect(disconnect).toBeDefined();
    expect(disconnect!.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it("warns when mode 'events' has no span to add them to", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      instrumentConsumerEvents({ on: () => {} }, { mode: 'events' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('records the error a KafkaJS crash event carries in its payload', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const recorded: unknown[] = [];
    instrumentConsumerEvents(
      {
        on: (event: string, listener: (payload: unknown) => void) =>
          listeners.set(event, listener),
      },
      {
        // SAFETY: the instrumentation calls only these two span methods.
        lifecycleSpan: {
          addEvent: () => {},
          recordException: (error: unknown) => recorded.push(error),
        } as unknown as Span,
      },
    );
    const crash = new Error('broker gone');
    listeners.get('consumer.crash')!({
      type: 'consumer.crash',
      payload: { error: crash, groupId: 'g' },
    });

    expect(recorded).toEqual([crash]);
  });
});
