import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { readPlan } from 'autotel-db';
import PlanDiagnosis from './PlanDiagnosis.svelte';
import { sampleQueryTraces } from './__fixtures__/queries';

// Catalogue only — behaviour is pinned in PlanDiagnosis.test.ts.
const [, scan, indexed, audit] = sampleQueryTraces();
const planOf = (trace: typeof scan, spanId: string) =>
  readPlan(trace!.spans.find((s) => s.spanId === spanId)!.attributes);

const meta = {
  title: 'Components/PlanDiagnosis',
  component: PlanDiagnosis,
} satisfies Meta<typeof PlanDiagnosis>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A full scan with a blocking sort, and the index that removes both. */
export const FullScanWithAdvice: Story = {
  args: {
    plan: planOf(scan, 'find'),
    sample: { traceId: 't-orders-1', spanId: 'find', startMs: Date.now() },
  },
};

/** The same statement once the index exists. */
export const Indexed: Story = {
  args: { plan: planOf(indexed, 'find') },
};

/** The database refused the explain. */
export const Failed: Story = {
  args: { issue: planOf(audit, 'find') },
};

/** An insert: nothing to plan. */
export const Unsupported: Story = {
  args: { issue: planOf(audit, 'insert'), operation: 'insertMany' },
};

/** Explain is off in autotel-mongoose: the setup, and what each mode costs. */
export const ExplainOff: Story = {
  args: { system: 'mongodb', scope: 'autotel-mongoose' },
};

/** The official MongoDB driver plugin: plans have to be attached by hand. */
export const ManualDriver: Story = {
  args: { system: 'mongodb', scope: '@opentelemetry/instrumentation-mongodb' },
};

/** A source nothing in autotel explains. */
export const Unavailable: Story = {
  args: { system: 'redis', scope: '@opentelemetry/instrumentation-ioredis' },
};
