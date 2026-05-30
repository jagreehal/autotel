import type { Preview } from '@storybook/svelte-vite';
import '../src/widget/styles.css';

type ThemeValue = 'system' | 'light' | 'dark';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
  },
  // Theme toolbar — drives the same `data-theme` token swap the widget uses,
  // so dark mode is viewable and testable for every story.
  globalTypes: {
    theme: {
      description: 'Devtools theme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'system', title: 'System' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (story, context) => {
      const theme = (context.globals.theme as ThemeValue) ?? 'light';
      // Stories render in the light DOM (no shadow host), so the token swap is
      // driven by `:root[data-theme=...]` on the document element. The widget's
      // surface/foreground tokens are applied to the body so every story sits
      // on the themed background (replaces the old Preact wrapper <div>).
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);
        document.body.classList.add('bg-surface', 'text-fg');
      }
      return story();
    },
  ],
};

export default preview;
