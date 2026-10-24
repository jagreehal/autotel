import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTraceCollector } from 'autotel/testing';

// What `hono/route` does when the app runs another copy of Hono: the symbol it
// reads is private to its own copy, so the match result is undefined.
vi.mock('hono/route', () => ({
  matchedRoutes: () => {
    throw new TypeError("Cannot read properties of undefined (reading '0')");
  },
}));

const { autotelMiddleware } = await import('./hono');

describe('hono adapter beside another copy of Hono', () => {
  it('answers the request and names the route through the app’s own copy', async () => {
    const collector = createTraceCollector();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onEmit = vi.fn();
    const app = new Hono();
    app.use('*', autotelMiddleware({ requestLoggerOptions: { onEmit } }));
    app.get('/users/:id', (c) => c.text('ok'));

    const response = await app.request('/users/42');
    await app.request('/users/43');

    expect(response.status).toBe(200);
    expect(onEmit.mock.calls[0]?.[0].context['http.route']).toBe('/users/:id');
    expect(collector.getSpansByName('GET /users/:id')).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('different copies of Hono');
  });
});
