// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { setupUserInteractionInstrumentation } from './user-interaction';
import { captureEvents, eventsNamed } from './test-events';

function click(el: Element, init: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
}

describe('click instrumentation', () => {
  beforeEach(() => {
    captureEvents();
    document.body.innerHTML = '';
  });

  it('emits the canonical app.widget.click event', () => {
    document.body.innerHTML = '<button id="buy" aria-label="Buy now">Buy</button>';
    setupUserInteractionInstrumentation({ selectors: ['button'], debug: false });
    click(document.querySelector('#buy')!, { clientX: 12, clientY: 34 });

    const [span] = eventsNamed('app.widget.click');
    expect(span).toBeDefined();
    expect(span.attributes['app.widget.name']).toBe('Buy now');
    expect(span.attributes['app.widget.id']).toBe('buy');
    expect(span.attributes['app.widget.tag']).toBe('button');
    expect(span.attributes['app.screen.coordinate.x']).toBe(12);
    expect(span.attributes['app.screen.coordinate.y']).toBe(34);
  });

  it('names the screen from the path so clicks can be grouped by page', () => {
    document.body.innerHTML = '<button>Go</button>';
    setupUserInteractionInstrumentation({ selectors: ['button'], debug: false });
    click(document.querySelector('button')!);
    const [span] = eventsNamed('app.widget.click');
    expect(span.attributes['app.screen.name']).toBe(window.location.pathname);
  });

  it('prefers an explicit data-track name over the accessible one', () => {
    document.body.innerHTML =
      '<button data-track="checkout_submit" aria-label="Buy now">Buy</button>';
    setupUserInteractionInstrumentation({ selectors: ['button'], debug: false });
    click(document.querySelector('button')!);
    expect(eventsNamed('app.widget.click')[0].attributes['app.widget.name']).toBe(
      'checkout_submit',
    );
  });

  it('ignores clicks that match no configured selector', () => {
    document.body.innerHTML = '<div>not tracked</div>';
    setupUserInteractionInstrumentation({ selectors: ['button'], debug: false });
    click(document.querySelector('div')!);
    expect(eventsNamed('app.widget.click')).toHaveLength(0);
  });
});
