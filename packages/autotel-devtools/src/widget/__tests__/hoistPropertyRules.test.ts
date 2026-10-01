/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hoistPropertyRules } from '../shadow-styles';

afterEach(() => {
  document.head.innerHTML = '';
});

describe('hoistPropertyRules', () => {
  it("registers Tailwind's @property rules on the document, once", () => {
    const css = `
      .a { color: red }
      @property --tw-translate-x { syntax: "*"; inherits: false; initial-value: 0 }
      @property --tw-translate-y { syntax: "*"; inherits: false; initial-value: 0 }
      .b { translate: var(--tw-translate-x) var(--tw-translate-y) }`;
    hoistPropertyRules(css);
    hoistPropertyRules(css);
    const styles = document.head.querySelectorAll(
      'style[data-autotel-devtools-properties]',
    );
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain('@property --tw-translate-x');
    expect(styles[0]!.textContent).toContain('@property --tw-translate-y');
    expect(styles[0]!.textContent).not.toContain('.a');
  });
});
