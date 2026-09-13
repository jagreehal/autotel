import { describe, expect, it } from 'vitest';

import {
  createExporter,
  keyValues,
  parseHeaders,
  tracesUrl,
  type OtlpSpan,
} from './otlp';

type Posted = { url: string; body: string };

/** An exporter whose network and clock the test holds. */
function harness(endpoint = 'http://collector:4318') {
  const posts: Posted[] = [];
  const timers: Array<() => void> = [];
  const exporter = createExporter({
    fetch: async (url, init) => {
      posts.push({ url, body: init.body ?? '' });
      return { status: 200, ok: true, headers: {}, text: '' };
    },
    after: (_ms, fn) => {
      timers.push(fn);
      return { cancel: () => {} };
    },
    endpoint,
    headers: { authorization: 'Bearer t' },
    resource: { 'service.name': 'claude-code' },
  });
  const spans = (): OtlpSpan[] =>
    posts.flatMap((post) => {
      const payload: {
        resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
      } = JSON.parse(post.body);
      return payload.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    });
  return { exporter, posts, timers, spans };
}

describe('otlp', () => {
  it('encodes attribute values by kind, ints as strings', () => {
    expect(keyValues({ s: 'x', i: 3, d: 1.5, b: false })).toEqual([
      { key: 's', value: { stringValue: 'x' } },
      { key: 'i', value: { intValue: '3' } },
      { key: 'd', value: { doubleValue: 1.5 } },
      { key: 'b', value: { boolValue: false } },
    ]);
  });

  it('parses OTEL_EXPORTER_OTLP_HEADERS and normalises the endpoint', () => {
    expect(parseHeaders('a=1, b=x%20y,bad')).toEqual({ a: '1', b: 'x y' });
    expect(parseHeaders(undefined)).toEqual({});
    expect(tracesUrl('http://h:4318/')).toBe('http://h:4318/v1/traces');
    expect(tracesUrl('http://h:4318/v1/traces')).toBe(
      'http://h:4318/v1/traces',
    );
  });

  it('batches ended spans into one POST on the next timer tick', async () => {
    const h = harness();
    const parent = h.exporter.start('turn', { traceId: 'a'.repeat(32) });
    const child = h.exporter.start(
      'tool.call',
      { traceId: parent.traceId, parentSpanId: parent.spanId },
      { tool_name: 'Bash' },
    );
    child.addEvent('hook', { 'plugin.name': 'guard' });
    child.end({ error: 'boom' });
    parent.end();

    expect(h.posts).toHaveLength(0);
    expect(h.timers).toHaveLength(1);
    h.timers[0]?.();
    await h.exporter.flush();

    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]?.url).toBe('http://collector:4318/v1/traces');
    const [toolCall, turn] = h.spans();
    expect(turn).toMatchObject({ name: 'turn', spanId: parent.spanId });
    expect(turn?.parentSpanId).toBeUndefined();
    expect(toolCall).toMatchObject({
      name: 'tool.call',
      parentSpanId: parent.spanId,
      status: { code: 2, message: 'boom' },
      attributes: [{ key: 'tool_name', value: { stringValue: 'Bash' } }],
    });
    expect(toolCall?.events[0]?.name).toBe('hook');
  });

  it('ends a span once, whatever the caller does', () => {
    const h = harness();
    const span = h.exporter.start('x', { traceId: 'b'.repeat(32) });
    span.end();
    span.end({ error: 'late' });
    h.timers[0]?.();
    return h.exporter.flush().then(() => {
      expect(h.spans()).toHaveLength(1);
      expect(h.spans()[0]?.status).toEqual({ code: 1 });
    });
  });
});
