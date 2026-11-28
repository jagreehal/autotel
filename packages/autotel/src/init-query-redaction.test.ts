import { afterAll, describe, expect, it } from 'vitest';
import { init } from './init';
import { createMemoryExporter } from './memory-exporter';
import { flush, shutdown } from './shutdown';
import { trace } from './functional';

/**
 * Outside production, init() masks URL query values and nothing else: a query
 * string carries tokens and emails that no value pattern recognises, and
 * staging exports to real backends too.
 */
describe('URL query values outside production', () => {
  const exporter = createMemoryExporter();
  init({
    service: 'query-redaction-test',
    environment: 'staging',
    spanExporters: [exporter],
  });
  afterAll(() => shutdown());

  it('keeps names, masks values, and leaves other attributes alone', async () => {
    await trace.run('GET /search', async (ctx) => {
      ctx.setAttributes({
        'url.query': 'q=shoes&token=secret123',
        'url.full': 'https://shop.example/search?q=shoes&token=secret123',
        'user.email': 'a@b.c',
      });
    });
    await flush();
    const span = exporter.findSpan('GET /search');
    expect(span?.attributes['url.query']).toBe('q=REDACTED&token=REDACTED');
    expect(span?.attributes['url.full']).toBe(
      'https://shop.example/search?q=REDACTED&token=REDACTED',
    );
    expect(span?.attributes['user.email']).toBe('a@b.c');
  });
});
