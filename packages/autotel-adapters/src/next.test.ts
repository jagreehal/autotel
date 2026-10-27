import { describe, expect, it, vi } from 'vitest';
import { createTraceCollector } from 'autotel/testing';
import { useLogger, withAutotel, withAutotelAction } from './next';

describe('next adapter', () => {
  it('throws clear error when useLogger is called outside traced context', () => {
    expect(() => useLogger({ method: 'GET', url: '/api/orders' })).toThrow(
      '[autotel-adapters/next] No active trace context.',
    );
  });

  it('provides request-scoped logger inside withAutotel()', async () => {
    const handler = withAutotel(async (request: { url: string }) => {
      const log = useLogger(request);
      log.set({ feature: 'checkout' });
      return 'ok';
    });

    await expect(handler({ url: 'https://example.com/orders' })).resolves.toBe(
      'ok',
    );
  });

  it('auto-emits one wide event by default', async () => {
    const onEmit = vi.fn();
    const handler = withAutotel(
      async (request: { url: string }) => {
        useLogger(request).set({ feature: 'checkout' });
        return 'ok';
      },
      { requestLoggerOptions: { onEmit } },
    );

    await handler({ url: 'https://example.com/orders' });
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it('does not emit when autoEmit is false', async () => {
    const onEmit = vi.fn();
    const handler = withAutotel(async () => 'ok', {
      autoEmit: false,
      requestLoggerOptions: { onEmit },
    });

    await handler();
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('does not record Next navigation signals as request errors', async () => {
    const onEmit = vi.fn();
    const signal = { digest: 'NEXT_REDIRECT;replace;/login;307;' };
    const handler = withAutotel(
      async () => {
        throw signal;
      },
      { requestLoggerOptions: { onEmit } },
    );

    await expect(handler()).rejects.toBe(signal);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]?.[0].context).not.toHaveProperty(
      'error_message',
    );
  });

  it('unwraps a navigation signal from cause and leaves real errors alone', async () => {
    const signal = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };
    const wrapped = new Error('framework wrapper', { cause: signal });
    const handler = withAutotel(async () => {
      throw wrapped;
    });

    await expect(handler()).rejects.toBe(signal);
  });

  it('still records real application errors', async () => {
    const onEmit = vi.fn();
    const error = new Error('database unavailable');
    const handler = withAutotel(
      async () => {
        throw error;
      },
      { requestLoggerOptions: { onEmit } },
    );

    await expect(handler()).rejects.toBe(error);
    expect(onEmit.mock.calls[0]?.[0].context).toMatchObject({
      error_message: 'database unavailable',
      'http.response.status_code': 500,
    });
  });

  it('does not read a FormData first argument as the request', async () => {
    const onEmit = vi.fn();
    const form = new FormData();
    form.set('x-request-id', 'from-a-form-field');
    const handler = withAutotel(async (_form: FormData) => 'ok', {
      requestLoggerOptions: { onEmit },
    });

    await handler(form);
    expect(onEmit.mock.calls[0]?.[0].context).not.toHaveProperty(
      'http.request.id',
    );
  });
});

describe('withAutotelAction', () => {
  it('names the span action.<name>, records no HTTP fields, and serves useLogger()', async () => {
    const collector = createTraceCollector();
    const onEmit = vi.fn();
    const save = withAutotelAction(
      'save',
      async (form: FormData) => {
        useLogger().set({ 'item.id': form.get('id') });
        return 'saved';
      },
      { requestLoggerOptions: { onEmit } },
    );
    const form = new FormData();
    form.set('id', 'i1');

    await expect(save(form)).resolves.toBe('saved');
    expect(collector.expectSpan('action.save')).toBeDefined();
    const context = onEmit.mock.calls[0]?.[0].context;
    expect(context).toMatchObject({ 'item.id': 'i1' });
    expect(Object.keys(context).filter((k) => /^(http|url)\./.test(k))).toEqual(
      [],
    );
  });

  it('passes redirect() through as a non-error', async () => {
    const onEmit = vi.fn();
    const signal = { digest: 'NEXT_REDIRECT;replace;/done;303;' };
    const save = withAutotelAction(
      'save',
      async () => {
        throw signal;
      },
      { requestLoggerOptions: { onEmit } },
    );

    await expect(save()).rejects.toBe(signal);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]?.[0].context).not.toHaveProperty(
      'error_message',
    );
  });

  it('records a real error and rethrows it', async () => {
    const onEmit = vi.fn();
    const error = new Error('database unavailable');
    const save = withAutotelAction(
      'save',
      async () => {
        throw error;
      },
      { requestLoggerOptions: { onEmit } },
    );

    await expect(save()).rejects.toBe(error);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]?.[0].context).toMatchObject({
      error_message: 'database unavailable',
    });
  });
});
