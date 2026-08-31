// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupFrustrationSignals } from './frustration';
import { captureEvents, eventsNamed } from './test-events';

const EVENT = 'app.widget.click.frustration';

let teardown: (() => void) | undefined;

function click(el: Element, init: MouseEventInit = {}): void {
  el.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      clientX: 10,
      clientY: 10,
      ...init,
    }),
  );
}

/** Let queued microtasks (MutationObserver callbacks) run, then advance timers. */
async function settle(ms: number): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  captureEvents();
  document.body.innerHTML =
    '<button id="buy" aria-label="Buy now">Buy</button>';
});

afterEach(() => {
  teardown?.();
  teardown = undefined;
  vi.useRealTimers();
});

describe('dead clicks', () => {
  it('reports a click that changed nothing', async () => {
    teardown = setupFrustrationSignals({ debug: false });
    click(document.querySelector('#buy')!);
    await settle(4000);

    const dead = eventsNamed(EVENT).filter(
      (s) => s.attributes['app.widget.click.outcome'] === 'dead',
    );
    expect(dead).toHaveLength(1);
    expect(dead[0].attributes['app.widget.click.verdict_signal']).toBe(
      'absolute',
    );
  });

  it('carries the canonical attributes of what was clicked', async () => {
    teardown = setupFrustrationSignals({ debug: false });
    click(document.querySelector('#buy')!, { clientX: 42, clientY: 7 });
    await settle(4000);

    const [span] = eventsNamed(EVENT);
    expect(span.attributes['app.widget.name']).toBe('Buy now');
    expect(span.attributes['app.widget.id']).toBe('buy');
    expect(span.attributes['app.screen.coordinate.x']).toBe(42);
    expect(span.attributes['app.screen.coordinate.y']).toBe(7);
  });

  it('stays quiet when the DOM changes in response', async () => {
    teardown = setupFrustrationSignals({ debug: false });
    click(document.querySelector('#buy')!);
    document.body.append(document.createElement('div'));
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('stays quiet when the page scrolls in response', async () => {
    teardown = setupFrustrationSignals({ debug: false });
    click(document.querySelector('#buy')!);
    window.dispatchEvent(new Event('scroll'));
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('stays quiet when the selection changes in response', async () => {
    teardown = setupFrustrationSignals({ debug: false });
    click(document.querySelector('#buy')!);
    document.dispatchEvent(new Event('selectionchange'));
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('stays quiet when the click sent the tab away', async () => {
    teardown = setupFrustrationSignals({ debug: false });
    click(document.querySelector('#buy')!);
    window.dispatchEvent(new Event('blur'));
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('never judges an anchor, which is a legitimate activation', async () => {
    document.body.innerHTML = '<a href="/next">Next</a>';
    teardown = setupFrustrationSignals({ debug: false });
    click(document.querySelector('a')!);
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('never judges a click held with a modifier key', async () => {
    teardown = setupFrustrationSignals({ debug: false });
    click(document.querySelector('#buy')!, { metaKey: true });
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('honours an ignore selector', async () => {
    teardown = setupFrustrationSignals({
      debug: false,
      deadClicks: { ignoreSelector: '#buy' },
    });
    click(document.querySelector('#buy')!);
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('reports a repeatedly clicked dead element once', async () => {
    teardown = setupFrustrationSignals({ debug: false, rage: false });
    const button = document.querySelector('#buy')!;
    click(button);
    click(button);
    click(button);
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(1);
  });

  it('can be turned off', async () => {
    teardown = setupFrustrationSignals({ debug: false, deadClicks: false });
    click(document.querySelector('#buy')!);
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });
});

describe('rage clicks', () => {
  it('reports three fast clicks in the same spot', async () => {
    teardown = setupFrustrationSignals({ debug: false, deadClicks: false });
    const button = document.querySelector('#buy')!;
    click(button, { clientX: 10, clientY: 10 });
    click(button, { clientX: 12, clientY: 11 });
    click(button, { clientX: 11, clientY: 13 });

    const rage = eventsNamed(EVENT).filter(
      (s) => s.attributes['app.widget.click.outcome'] === 'rage',
    );
    expect(rage).toHaveLength(1);
    expect(rage[0].attributes['app.widget.click.rage_count']).toBe(3);
    expect(rage[0].attributes['app.widget.name']).toBe('Buy now');
  });

  it('does not fire for clicks spread across the page', async () => {
    teardown = setupFrustrationSignals({ debug: false, deadClicks: false });
    const button = document.querySelector('#buy')!;
    click(button, { clientX: 10, clientY: 10 });
    click(button, { clientX: 300, clientY: 10 });
    click(button, { clientX: 10, clientY: 300 });
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('does not fire for clicks spread over time', async () => {
    teardown = setupFrustrationSignals({ debug: false, deadClicks: false });
    const button = document.querySelector('#buy')!;
    click(button);
    await settle(1500);
    click(button);
    await settle(1500);
    click(button);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });

  it('reports each burst once rather than every click after the third', async () => {
    teardown = setupFrustrationSignals({ debug: false, deadClicks: false });
    const button = document.querySelector('#buy')!;
    for (let i = 0; i < 6; i++) click(button);
    expect(eventsNamed(EVENT)).toHaveLength(1);
  });

  it('can be turned off', async () => {
    teardown = setupFrustrationSignals({
      debug: false,
      rage: false,
      deadClicks: false,
    });
    const button = document.querySelector('#buy')!;
    click(button);
    click(button);
    click(button);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });
});

describe('teardown', () => {
  it('stops listening', async () => {
    const stop = setupFrustrationSignals({ debug: false });
    stop();
    click(document.querySelector('#buy')!);
    await settle(4000);
    expect(eventsNamed(EVENT)).toHaveLength(0);
  });
});
