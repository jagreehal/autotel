import { init } from 'autotel';

init({
  service: 'next-app',
  debug: true,
  // Filter out noisy Next.js internal spans
  spanFilter: (span) => span.instrumentationScope.name !== 'next.js',
});