// The build takes nine minutes and everyone has a theory about which job is to
// blame. A pipeline is a request that happens to run for nine minutes. Give the
// run a root span, give each job a child, and you read the critical path as the
// widest bar in the same waterfall you already use.

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

console.log('OE 18: one pipeline run, read as one trace');
console.log(
  `  ${children.length} jobs under ci.pipeline: ${children.map((child) => child.name).join(', ')}`,
);
