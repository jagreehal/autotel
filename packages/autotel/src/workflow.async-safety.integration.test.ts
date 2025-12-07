/**
 * Workflow Async Safety Tests
 *
 * These tests verify that concurrent workflows are properly isolated
 * using AsyncLocalStorage. Previously, a module-level variable was used
 * which caused race conditions when multiple workflows ran concurrently.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  traceWorkflow,
  traceStep,
  getCurrentWorkflowContext,
  isInWorkflow,
} from './workflow';
import { init } from './init';
import { shutdown } from './shutdown';
import { resetConfig, getConfig } from './config';
import { InMemorySpanExporter } from './exporters';
import { SimpleSpanProcessor } from './processors';

describe('Workflow Async Safety', () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    // Reset config to ensure fresh tracer after SDK setup
    resetConfig();
    exporter = new InMemorySpanExporter();
    init({
      service: 'test-workflow-async-safety',
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    // Reset again to pick up the newly configured tracer provider
    resetConfig();
  });

  afterEach(async () => {
    await shutdown();
    exporter.reset();
  });

  it('should isolate concurrent workflows', async () => {
    const results: string[] = [];

    // Debug: check config state
    console.log(
      'Config tracer constructor:',
      getConfig().tracer?.constructor?.name,
    );

    const workflow1 = traceWorkflow({
      name: 'Workflow1',
      workflowId: 'wf-1',
    })((ctx) => async () => {
      console.log('workflow1 factory called, ctx:', ctx?.getWorkflowId?.());
      // Record initial ID
      results.push(`w1-start: ${ctx.getWorkflowId()}`);

      // Simulate async work with delay
      await sleep(20);

      // Record ID after delay (should still be the same)
      results.push(`w1-end: ${ctx.getWorkflowId()}`);

      return ctx.getWorkflowId();
    });

    const workflow2 = traceWorkflow({
      name: 'Workflow2',
      workflowId: 'wf-2',
    })((ctx) => async () => {
      // Record initial ID
      results.push(`w2-start: ${ctx.getWorkflowId()}`);

      // Simulate async work with delay
      await sleep(10);

      // Record ID after delay (should still be the same)
      results.push(`w2-end: ${ctx.getWorkflowId()}`);

      return ctx.getWorkflowId();
    });

    // Run workflows concurrently
    const [r1, r2] = await Promise.all([workflow1(), workflow2()]);

    // Verify return values are correct
    expect(r1).toBe('wf-1');
    expect(r2).toBe('wf-2');

    // Verify each workflow maintained its own ID throughout execution
    expect(results).toContain('w1-start: wf-1');
    expect(results).toContain('w1-end: wf-1');
    expect(results).toContain('w2-start: wf-2');
    expect(results).toContain('w2-end: wf-2');

    // Verify no cross-contamination (w1 should never see wf-2 and vice versa)
    expect(
      results
        .filter((r) => r.startsWith('w1-'))
        .every((r) => r.includes('wf-1')),
    ).toBe(true);
    expect(
      results
        .filter((r) => r.startsWith('w2-'))
        .every((r) => r.includes('wf-2')),
    ).toBe(true);
  });

  it('should isolate workflow contexts with getCurrentWorkflowContext()', async () => {
    const contextIds: string[] = [];

    const workflow1 = traceWorkflow({
      name: 'Workflow1',
      workflowId: 'wf-ctx-1',
    })(() => async () => {
      await sleep(10);
      const ctx = getCurrentWorkflowContext();
      contextIds.push(`w1: ${ctx?.getWorkflowId() ?? 'null'}`);
    });

    const workflow2 = traceWorkflow({
      name: 'Workflow2',
      workflowId: 'wf-ctx-2',
    })(() => async () => {
      const ctx = getCurrentWorkflowContext();
      contextIds.push(`w2: ${ctx?.getWorkflowId() ?? 'null'}`);
    });

    await Promise.all([workflow1(), workflow2()]);

    expect(contextIds).toContain('w1: wf-ctx-1');
    expect(contextIds).toContain('w2: wf-ctx-2');
  });

  it('should isolate isInWorkflow() across concurrent workflows', async () => {
    let outsideWorkflow = true;
    const insideWorkflow: boolean[] = [];

    // Check outside
    outsideWorkflow = isInWorkflow();

    const workflow1 = traceWorkflow({
      name: 'Workflow1',
      workflowId: 'wf-check-1',
    })(() => async () => {
      await sleep(10);
      insideWorkflow.push(isInWorkflow());
    });

    const workflow2 = traceWorkflow({
      name: 'Workflow2',
      workflowId: 'wf-check-2',
    })(() => async () => {
      insideWorkflow.push(isInWorkflow());
    });

    await Promise.all([workflow1(), workflow2()]);

    // Outside should be false
    expect(outsideWorkflow).toBe(false);

    // Both inside checks should be true
    expect(insideWorkflow).toEqual([true, true]);

    // After workflows complete, should be false again
    expect(isInWorkflow()).toBe(false);
  });

  it('should register compensations with correct workflow', async () => {
    const compensations: string[] = [];

    const workflow1 = traceWorkflow({
      name: 'Workflow1',
      workflowId: 'wf-comp-1',
    })((ctx) => async () => {
      ctx.registerCompensation('step1', () => {
        compensations.push('wf-1:step1');
      });
      ctx.completeStep('step1');
      await sleep(10);
      throw new Error('trigger compensation 1');
    });

    const workflow2 = traceWorkflow({
      name: 'Workflow2',
      workflowId: 'wf-comp-2',
    })((ctx) => async () => {
      ctx.registerCompensation('step1', () => {
        compensations.push('wf-2:step1');
      });
      ctx.completeStep('step1');
      throw new Error('trigger compensation 2');
    });

    await Promise.allSettled([workflow1(), workflow2()]);

    // Each workflow should have triggered its own compensation
    expect(compensations.filter((c) => c.startsWith('wf-1'))).toHaveLength(1);
    expect(compensations.filter((c) => c.startsWith('wf-2'))).toHaveLength(1);
    expect(compensations).toContain('wf-1:step1');
    expect(compensations).toContain('wf-2:step1');
  });

  it('should isolate traceStep() within concurrent workflows', async () => {
    const stepWorkflows: string[] = [];

    const workflow1 = traceWorkflow({
      name: 'Workflow1',
      workflowId: 'wf-step-1',
    })(() => async () => {
      await sleep(15);

      const step = traceStep({
        name: 'MyStep',
      })(async () => {
        const ctx = getCurrentWorkflowContext();
        stepWorkflows.push(`w1-step: ${ctx?.getWorkflowId() ?? 'null'}`);
      });

      await step();
    });

    const workflow2 = traceWorkflow({
      name: 'Workflow2',
      workflowId: 'wf-step-2',
    })(() => async () => {
      await sleep(5);

      const step = traceStep({
        name: 'MyStep',
      })(async () => {
        const ctx = getCurrentWorkflowContext();
        stepWorkflows.push(`w2-step: ${ctx?.getWorkflowId() ?? 'null'}`);
      });

      await step();
    });

    await Promise.all([workflow1(), workflow2()]);

    // Each step should see its parent workflow's ID
    expect(stepWorkflows).toContain('w1-step: wf-step-1');
    expect(stepWorkflows).toContain('w2-step: wf-step-2');
  });

  it('should handle many concurrent workflows', async () => {
    const NUM_WORKFLOWS = 20;
    const results = new Map<string, string[]>();

    const workflows = Array.from({ length: NUM_WORKFLOWS }, (_, i) => {
      const id = `wf-${i}`;
      results.set(id, []);

      return traceWorkflow({
        name: `Workflow${i}`,
        workflowId: id,
      })((ctx) => async () => {
        const myResults = results.get(id)!;

        myResults.push(`start: ${ctx.getWorkflowId()}`);

        // Random delay to increase chance of interleaving
        await sleep(Math.random() * 20);

        myResults.push(`middle: ${ctx.getWorkflowId()}`);

        await sleep(Math.random() * 10);

        myResults.push(`end: ${ctx.getWorkflowId()}`);

        return ctx.getWorkflowId();
      });
    });

    const returned = await Promise.all(workflows.map((w) => w()));

    // Verify all workflows returned correct IDs
    for (let i = 0; i < NUM_WORKFLOWS; i++) {
      expect(returned[i]).toBe(`wf-${i}`);
    }

    // Verify each workflow maintained its own context
    for (let i = 0; i < NUM_WORKFLOWS; i++) {
      const id = `wf-${i}`;
      const myResults = results.get(id)!;

      expect(myResults).toHaveLength(3);
      expect(myResults.every((r) => r.includes(id))).toBe(true);
    }
  });

  it('should support nested workflows with isolated contexts', async () => {
    const nestedResults: string[] = [];

    const outerWorkflow = traceWorkflow({
      name: 'OuterWorkflow',
      workflowId: 'wf-outer',
    })((ctx) => async () => {
      nestedResults.push(`outer-start: ${ctx.getWorkflowId()}`);

      // Inner workflow should have its own context
      const innerWorkflow = traceWorkflow({
        name: 'InnerWorkflow',
        workflowId: 'wf-inner',
      })((innerCtx) => async () => {
        nestedResults.push(`inner: ${innerCtx.getWorkflowId()}`);

        // getCurrentWorkflowContext should return inner context
        const current = getCurrentWorkflowContext();
        nestedResults.push(
          `inner-current: ${current?.getWorkflowId() ?? 'null'}`,
        );

        return innerCtx.getWorkflowId();
      });

      await innerWorkflow();

      // After inner completes, outer should still have its context
      nestedResults.push(`outer-end: ${ctx.getWorkflowId()}`);

      // getCurrentWorkflowContext should return outer context again
      const current = getCurrentWorkflowContext();
      nestedResults.push(
        `outer-current: ${current?.getWorkflowId() ?? 'null'}`,
      );

      return ctx.getWorkflowId();
    });

    const result = await outerWorkflow();

    expect(result).toBe('wf-outer');
    expect(nestedResults).toContain('outer-start: wf-outer');
    expect(nestedResults).toContain('inner: wf-inner');
    expect(nestedResults).toContain('inner-current: wf-inner');
    expect(nestedResults).toContain('outer-end: wf-outer');
    expect(nestedResults).toContain('outer-current: wf-outer');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
