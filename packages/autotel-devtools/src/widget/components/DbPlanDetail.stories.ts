import type { Meta, StoryObj } from '@storybook/svelte-vite';
import DbPlanDetail from './DbPlanDetail.svelte';
import { sampleQueryTraces } from './__fixtures__/queries';

// Catalogue only — behaviour is pinned in DbPlanDetail.test.ts.
const [feed, scan, indexed] = sampleQueryTraces();

const meta = {
  title: 'Components/DbPlanDetail',
  component: DbPlanDetail,
} satisfies Meta<typeof DbPlanDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A COLLSCAN reading 60,000 documents for 16, with the index to create. */
export const FullScan: Story = {
  args: { span: scan!.spans.find((s) => s.spanId === 'find')!, trace: scan! },
};

/** The same statement once the index exists. */
export const Indexed: Story = {
  args: {
    span: indexed!.spans.find((s) => s.spanId === 'find')!,
    trace: indexed!,
  },
};

/** No plan, but the statement ran five times in its trace. */
export const RepeatedInTrace: Story = {
  args: { span: feed!.spans.find((s) => s.spanId === 'c0')!, trace: feed! },
};
