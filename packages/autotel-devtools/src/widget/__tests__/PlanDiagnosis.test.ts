/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import { readPlan } from 'autotel-db';
import PlanDiagnosis from '../components/PlanDiagnosis.svelte';
import { selectedTraceIdSignal } from '../store.svelte';

describe('PlanDiagnosis', () => {
  afterEach(cleanup);

  it('says a planner-only plan has no execution counts, and how to get them', () => {
    const plan = readPlan({
      'db.plan.status': 'captured',
      'db.plan.mode': 'plan',
      'db.plan.stages': ['Seq Scan'],
      'db.plan.full_scan': true,
      'db.plan.rows_estimated': 397,
    })!;
    render(PlanDiagnosis, { props: { plan } });
    expect(screen.getByText('planner only')).toBeTruthy();
    expect(screen.getByText(/The planner expected 397 rows/)).toBeTruthy();
    expect(screen.getByText(/explain: 'analyze'/)).toBeTruthy();
  });

  it('links the run its plan came from', async () => {
    const plan = readPlan({
      'db.plan.status': 'captured',
      'db.plan.node': 'IXSCAN',
    })!;
    render(PlanDiagnosis, {
      props: { plan, sample: { traceId: 't-9', spanId: 's-9', startMs: 0 } },
    });
    await fireEvent.click(screen.getByText(/open run/));
    expect(selectedTraceIdSignal.value).toBe('t-9');
  });

  it('gives the explain setup, with the cost of each mode, when explain is off', () => {
    render(PlanDiagnosis, {
      props: { system: 'mongodb', scope: 'autotel-mongoose' },
    });
    expect(screen.getByText(/instrumentMongoose\(mongoose/)).toBeTruthy();
    expect(screen.getByText(/runs each read again/)).toBeTruthy();
  });

  it('gives the plain MongoDB driver the manual path, not Mongoose setup', () => {
    render(PlanDiagnosis, {
      props: {
        system: 'mongodb',
        scope: '@opentelemetry/instrumentation-mongodb',
      },
    });
    expect(screen.getByText(/does not explain on its own/)).toBeTruthy();
    expect(screen.getByText(/planFromExplain/)).toBeTruthy();
  });

  it('says plainly when nothing captures plans for the source', () => {
    render(PlanDiagnosis, {
      props: {
        system: 'mysql',
        scope: '@opentelemetry/instrumentation-mysql2',
      },
    });
    expect(
      screen.getByText(/No autotel instrumentation captures mysql plans/),
    ).toBeTruthy();
    expect(screen.queryByText(/instrumentMongoose/)).toBeNull();
  });
});
