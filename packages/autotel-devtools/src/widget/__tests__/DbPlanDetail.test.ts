/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import DbPlanDetail from '../components/DbPlanDetail.svelte';
import { sampleQueryTraces } from '../components/__fixtures__/queries';

describe('DbPlanDetail', () => {
  afterEach(cleanup);
  const [feed, , indexed, audit] = sampleQueryTraces();

  it('shows the stages and indexes an indexed plan used, with no suggestion', () => {
    const span = indexed!.spans.find((s) => s.spanId === 'find')!;
    render(DbPlanDetail, { props: { span, trace: indexed! } });
    const plan = screen.getByTestId('db-plan');
    expect(screen.getByLabelText('Plan stages').textContent).toMatch(
      /FETCH\s*→\s*IXSCAN/,
    );
    expect(plan.textContent).toContain('status_1_createdAt_-1_total_1');
    expect(plan.textContent).toContain('Keys examined');
    expect(plan.textContent).not.toContain('Suggested index');
    // This span is the run, so no link back to it.
    expect(screen.queryByText(/open run/)).toBeNull();
  });

  it('says in one line when explain is off', () => {
    const span = feed!.spans.find((s) => s.spanId === 'p')!;
    render(DbPlanDetail, { props: { span, trace: feed! } });
    expect(screen.getByText(/explain is off/)).toBeTruthy();
    expect(screen.queryByText(/instrumentDrizzleClient/)).toBeNull();
  });

  it('says an insert has nothing to plan', () => {
    const span = audit!.spans.find((s) => s.spanId === 'insert')!;
    render(DbPlanDetail, { props: { span, trace: audit! } });
    expect(screen.getByText(/No plan for insertMany/)).toBeTruthy();
  });
});
