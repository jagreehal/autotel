// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addBreadcrumb,
  collectBreadcrumbs,
  configureBreadcrumbs,
  readBreadcrumbs,
  resetBreadcrumbsForTesting,
} from './breadcrumbs';

beforeEach(() => resetBreadcrumbsForTesting());

describe('breadcrumbs', () => {
  it('records what happened, oldest first', () => {
    addBreadcrumb({ message: 'clicked Buy' });
    addBreadcrumb({ message: 'fetch /checkout' });
    expect(readBreadcrumbs().map((b) => b.message)).toEqual([
      'clicked Buy',
      'fetch /checkout',
    ]);
  });

  it('timestamps every step', () => {
    addBreadcrumb({ message: 'x' });
    expect(typeof readBreadcrumbs()[0].timestamp).toBe('number');
  });

  it('keeps arbitrary detail alongside the message', () => {
    addBreadcrumb({ message: 'click', category: 'ui', data: { id: 'buy' } });
    expect(readBreadcrumbs()[0]).toMatchObject({
      message: 'click',
      category: 'ui',
      data: { id: 'buy' },
    });
  });

  it('drops the oldest steps once the byte budget is spent', () => {
    configureBreadcrumbs({ maxBytes: 500 });
    for (let i = 0; i < 200; i++) {
      addBreadcrumb({ message: `step ${i} with some padding text` });
    }
    const kept = readBreadcrumbs();
    expect(kept.length).toBeLessThan(200);
    expect(kept.at(-1)!.message).toContain('step 199');
    expect(new TextEncoder().encode(JSON.stringify(kept)).byteLength)
      .toBeLessThanOrEqual(500);
  });

  it('keeps the newest step even when it alone exceeds the budget', () => {
    // Losing the step nearest the error is the one loss that defeats the point.
    configureBreadcrumbs({ maxBytes: 50 });
    addBreadcrumb({ message: 'a'.repeat(500) });
    expect(readBreadcrumbs()).toHaveLength(1);
  });

  it('can be turned off', () => {
    configureBreadcrumbs(false);
    addBreadcrumb({ message: 'ignored' });
    expect(readBreadcrumbs()).toEqual([]);
  });

  it('redacts each step through the configured redactor', () => {
    configureBreadcrumbs({ redactor: (text) => text.replaceAll(/\d/g, '*') });
    addBreadcrumb({ message: 'card 4242' });
    expect(readBreadcrumbs()[0].message).toBe('card ****');
  });
});

describe('automatic breadcrumb collection', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it('records console output as steps rather than a second log pipeline', () => {
    stop = collectBreadcrumbs({ console: true });
    console.warn('disk almost full', 91);
    const [crumb] = readBreadcrumbs();
    expect(crumb.category).toBe('console');
    expect(crumb.message).toContain('disk almost full');
    expect(crumb.data).toMatchObject({ level: 'warn' });
  });

  it('still calls through to the real console', () => {
    const seen: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => seen.push(args);
    stop = collectBreadcrumbs({ console: true });
    console.warn('hello');
    stop();
    console.warn = original;
    expect(seen).toHaveLength(1);
  });

  it('records clicks as steps', () => {
    document.body.innerHTML = '<button aria-label="Buy now">Buy</button>';
    stop = collectBreadcrumbs({ clicks: true });
    document
      .querySelector('button')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(readBreadcrumbs()[0]).toMatchObject({
      category: 'ui',
      message: 'click Buy now',
    });
  });

  it('restores the console on teardown', () => {
    const before = console.warn;
    stop = collectBreadcrumbs({ console: true });
    expect(console.warn).not.toBe(before);
    stop();
    expect(console.warn).toBe(before);
  });
});
