import type { Preview } from '@storybook/preact-vite';
import { h } from 'preact';
import '../src/widget/styles.css';

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
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#1f2937' },
      ],
    },
  },
  decorators: [
    (Story) => h('div', { class: 'h-screen w-screen' }, h(Story, {})),
  ],
};

export default preview;
