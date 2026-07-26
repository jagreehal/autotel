import { span, withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';

const collector = createTraceCollector();
const runPipeline = withTracing({ name: 'ci.pipeline' })((ctx) => async () => {
  ctx.setAttributes({
    'ci.repository': 'autotel',
    'ci.change.class': 'package',
  });
  await span('ci.typecheck', () => Promise.resolve());
  await span('ci.test', () => Promise.resolve());
  await span('ci.build', () => Promise.resolve());
});

await runPipeline();

const root = collector.expectSpan('ci.pipeline');
const children = collector.getDescendants(root.spanId);
if (children.length !== 3) {
  throw new Error(`Expected 3 pipeline jobs, received ${children.length}`);
}

console.log('OE 18: represented one delivery pipeline as a trace');
console.log(`  jobs: ${children.map((child) => child.name).join(', ')}`);
