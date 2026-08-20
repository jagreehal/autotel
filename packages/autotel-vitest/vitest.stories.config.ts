import { defineConfig } from 'vitest/config';
import { StoryReporter } from 'executable-stories-vitest/reporter';

// Story suite: runs alongside the unit tests, never inside them. The stories
// exercise autotel's public API and the report they produce carries the real
// spans the fixture recorded while doing it.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['stories/**/*.story.test.ts'],
    setupFiles: ['./stories/setup.ts'],
    reporters: [
      'default',
      new StoryReporter({
        formats: ['html', 'markdown', 'story-report-json'],
        outputDir: 'reports',
        outputName: 'index',
        rawRunPath: 'reports/raw-run.json',
      }),
    ],
  },
});
