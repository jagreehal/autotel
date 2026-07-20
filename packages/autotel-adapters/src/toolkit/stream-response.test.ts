import { describe, expect, it, vi } from 'vitest';
import {
  bindStreamingResponseLifecycle,
  shouldDeferEmitForResponse,
} from './stream-response';

describe('stream-response', () => {
  it('detects SSE responses', () => {
    const response = new Response('data', {
      headers: { 'content-type': 'text/event-stream' },
    });
    expect(shouldDeferEmitForResponse(response)).toBe(true);
  });

  it('defers completion until stream finishes', async () => {
    const onComplete = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'));
        controller.close();
      },
    });
    const response = new Response(stream, {
      headers: { 'content-type': 'text/event-stream' },
    });

    const wrapped = bindStreamingResponseLifecycle(response, onComplete);
    expect(wrapped).not.toBe(response);
    await wrapped.text();
    expect(onComplete).toHaveBeenCalledWith({ status: 200 });
  });
});
