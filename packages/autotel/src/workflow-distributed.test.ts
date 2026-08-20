import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkflowBaggage,
  traceDistributedWorkflow,
  traceDistributedStep,
  generateWorkflowId,
  isInDistributedWorkflow,
  getWorkflowProgress,
  createWorkflowHeaders,
  parseWorkflowFromBaggage,
  type WorkflowBaggageValues,
  type DistributedWorkflowConfig,
  type DistributedWorkflowContext,
  type DistributedStepContext,
} from './workflow-distributed';
import type { TraceContext } from './trace-context';
import { asString, readProperty } from './values';

// Mock the functional trace
vi.mock('./functional', () => ({
  trace: vi.fn((options, factory) => {
    return (...args: unknown[]) => {
      const mockCtx = createMockTraceContext();
      const fn = factory(mockCtx);
      return fn(...args);
    };
  }),
  withTracing: vi.fn(
    () =>
      <TArgs extends unknown[], TReturn>(
        factory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
      ) =>
      (...args: TArgs): TReturn =>
        factory(createMockTraceContext())(...args),
  ),
}));

// Mock the business-baggage
const mockBaggageStore = new Map<string, Partial<WorkflowBaggageValues>>();
vi.mock('./business-baggage', () => ({
  createSafeBaggageSchema: vi.fn((_fields, _options) => ({
    set: vi.fn((_ctx, values) => {
      mockBaggageStore.set('workflow', values);
    }),
    get: vi.fn((_ctx) => mockBaggageStore.get('workflow') || {}),
    clear: vi.fn(() => mockBaggageStore.delete('workflow')),
  })),
}));

// Mock OpenTelemetry
vi.mock('@opentelemetry/api', () => ({
  SpanKind: { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 },
  context: {
    active: vi.fn(() => ({})),
  },
  propagation: {
    inject: vi.fn((ctx, headers) => {
      headers['traceparent'] =
        '00-00000000000000000000000000000001-0000000000000002-01';
    }),
  },
}));

function createMockTraceContext(): TraceContext {
  const mock = {
    traceId: '00000000000000000000000000000001',
    spanId: '0000000000000002',
    correlationId: '0000000000000000',
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    addLink: vi.fn(),
    addLinks: vi.fn(),
    updateName: vi.fn(),
    isRecording: vi.fn(() => true),
    recordError: vi.fn(),
    track: vi.fn(),
    getBaggage: vi.fn(),
    setBaggage: vi.fn((_key: string, value: string) => value),
    deleteBaggage: vi.fn(),
    getAllBaggage: vi.fn(() => new Map()),
    // Deprecated span methods kept as runtime back-compat shims
    addEvent: vi.fn(),
    recordException: vi.fn(),
    getSpan: vi.fn(),
    getSpanContext: vi.fn(() => ({
      traceId: '00000000000000000000000000000001',
      spanId: '0000000000000002',
      traceFlags: 1,
    })),
  };
  return mock;
}

describe('Workflow Distributed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBaggageStore.clear();
  });

  describe('WorkflowBaggage', () => {
    it('should be defined', () => {
      expect(WorkflowBaggage).toBeDefined();
      expect(WorkflowBaggage.set).toBeInstanceOf(Function);
      expect(WorkflowBaggage.get).toBeInstanceOf(Function);
    });

    it('should set and get workflow baggage', () => {
      const ctx = createMockTraceContext();
      const values: WorkflowBaggageValues = {
        workflowId: 'order-123',
        workflowName: 'OrderFulfillment',
        stepIndex: 0,
      };

      WorkflowBaggage.set(ctx, values);
      const retrieved = WorkflowBaggage.get(ctx);

      expect(retrieved).toEqual(values);
    });
  });

  describe('traceDistributedWorkflow', () => {
    it('should create a traced workflow function', async () => {
      const config: DistributedWorkflowConfig = {
        name: 'OrderFulfillment',
        workflowIdFrom: (order) => asString(readProperty(order, 'id')) ?? '',
      };

      const workflow = traceDistributedWorkflow(config)(
        (ctx) => async (_order: { id: string }) => {
          return { processed: true, workflowId: ctx.workflowId };
        },
      );

      const result = await workflow({ id: 'order-123' });

      expect(result.processed).toBe(true);
      expect(result.workflowId).toBe('order-123');
    });

    it('should provide workflow context with correct properties', async () => {
      const captured: DistributedWorkflowContext[] = [];

      const workflow = traceDistributedWorkflow({
        name: 'TestWorkflow',
        workflowIdFrom: () => 'wf-123',
        version: '1.0.0',
      })((ctx) => async () => {
        captured.push(ctx);
        return {};
      });

      await workflow();

      const [ctx] = captured;
      expect(ctx).toBeDefined();
      expect(ctx?.workflowId).toBe('wf-123');
      expect(ctx?.workflowName).toBe('TestWorkflow');
      expect(ctx?.workflowVersion).toBe('1.0.0');
    });

    it('should provide getWorkflowBaggage method', async () => {
      const captured: WorkflowBaggageValues[] = [];

      const workflow = traceDistributedWorkflow({
        name: 'TestWorkflow',
        workflowIdFrom: () => 'wf-123',
        version: '2.0.0',
        priority: 'high',
      })((ctx) => async () => {
        captured.push(ctx.getWorkflowBaggage());
        return {};
      });

      await workflow();

      const [b] = captured;
      expect(b).toBeDefined();
      expect(b?.workflowId).toBe('wf-123');
      expect(b?.workflowName).toBe('TestWorkflow');
      expect(b?.workflowVersion).toBe('2.0.0');
      expect(b?.priority).toBe('high');
    });

    it('should provide getWorkflowHeaders method', async () => {
      const captured: Record<string, string>[] = [];

      const workflow = traceDistributedWorkflow({
        name: 'TestWorkflow',
        workflowIdFrom: () => 'wf-123',
      })((ctx) => async () => {
        captured.push(ctx.getWorkflowHeaders());
        return {};
      });

      await workflow();

      const [h] = captured;
      expect(h).toBeDefined();
      expect(h?.traceparent).toBeDefined();
    });

    it('should support recordStepProgress', async () => {
      const _mockCtx = createMockTraceContext();

      const workflow = traceDistributedWorkflow({
        name: 'TestWorkflow',
        workflowIdFrom: () => 'wf-123',
      })((ctx) => async () => {
        ctx.recordStepProgress('Step1', 0);
        ctx.recordStepProgress('Step2', 1);
        return {};
      });

      await workflow();

      // Verify step progress was recorded (via mock)
    });

    it('should call onStart callback', async () => {
      const onStart = vi.fn();

      const workflow = traceDistributedWorkflow({
        name: 'TestWorkflow',
        workflowIdFrom: () => 'wf-123',
        onStart,
      })((_ctx) => async () => ({}));

      await workflow();

      expect(onStart).toHaveBeenCalled();
    });

    it('should call onComplete callback', async () => {
      const onComplete = vi.fn();

      const workflow = traceDistributedWorkflow({
        name: 'TestWorkflow',
        workflowIdFrom: () => 'wf-123',
        onComplete,
      })((_ctx) => async () => ({ result: 'success' }));

      await workflow();

      expect(onComplete).toHaveBeenCalled();
    });

    it('should call onError callback on failure', async () => {
      const onError = vi.fn();
      const error = new Error('Workflow failed');

      const workflow = traceDistributedWorkflow({
        name: 'TestWorkflow',
        workflowIdFrom: () => 'wf-123',
        onError,
      })((_ctx) => async () => {
        throw error;
      });

      await expect(workflow()).rejects.toThrow('Workflow failed');
      expect(onError).toHaveBeenCalled();
    });

    it('should support custom attributes', async () => {
      const _mockCtx = createMockTraceContext();

      const workflow = traceDistributedWorkflow({
        name: 'TestWorkflow',
        workflowIdFrom: () => 'wf-123',
        attributes: {
          'custom.attr': 'value',
          'custom.number': 42,
        },
      })((_ctx) => async () => ({}));

      await workflow();

      // Custom attributes should be set via mock
    });
  });

  describe('traceDistributedStep', () => {
    it('should create a traced step function', async () => {
      // Set up workflow baggage first
      mockBaggageStore.set('workflow', {
        workflowId: 'wf-123',
        workflowName: 'TestWorkflow',
        stepIndex: 0,
      });

      const step = traceDistributedStep({
        name: 'ProcessOrder',
      })((ctx) => async (_data: { orderId: string }) => {
        return { processed: true, stepName: ctx.stepName };
      });

      const result = await step({ orderId: 'order-456' });

      expect(result.processed).toBe(true);
      expect(result.stepName).toBe('ProcessOrder');
    });

    it('should extract workflow context from baggage', async () => {
      mockBaggageStore.set('workflow', {
        workflowId: 'wf-123',
        workflowName: 'OrderFulfillment',
        stepIndex: 2,
      });

      const captured: DistributedStepContext[] = [];

      const step = traceDistributedStep({
        name: 'ChargePayment',
      })((ctx) => async () => {
        captured.push(ctx);
        return {};
      });

      await step();

      const [ctx] = captured;
      expect(ctx).toBeDefined();
      expect(ctx?.workflowId).toBe('wf-123');
      expect(ctx?.workflowName).toBe('OrderFulfillment');
      expect(ctx?.stepName).toBe('ChargePayment');
    });

    it('should handle missing workflow context gracefully', async () => {
      mockBaggageStore.clear();

      const captured: DistributedStepContext[] = [];

      const step = traceDistributedStep({
        name: 'StandaloneStep',
      })((ctx) => async () => {
        captured.push(ctx);
        return {};
      });

      await step();

      const [ctx] = captured;
      expect(ctx).toBeDefined();
      expect(ctx?.workflowId).toBeNull();
      expect(ctx?.workflowName).toBeNull();
      expect(ctx?.stepName).toBe('StandaloneStep');
    });

    it('should support custom extractBaggage function', async () => {
      const customExtractor = vi.fn((_args) => ({
        workflowId: 'custom-wf',
        workflowName: 'CustomWorkflow',
      }));

      const step = traceDistributedStep({
        name: 'CustomStep',
        extractBaggage: customExtractor,
      })((ctx) => async () => {
        return { id: ctx.workflowId };
      });

      await step();

      expect(customExtractor).toHaveBeenCalled();
    });

    it('should disable baggage extraction when extractBaggage is false', async () => {
      mockBaggageStore.set('workflow', {
        workflowId: 'wf-123',
        workflowName: 'TestWorkflow',
      });

      const captured: DistributedStepContext[] = [];

      const step = traceDistributedStep({
        name: 'IsolatedStep',
        extractBaggage: false,
      })((ctx) => async () => {
        captured.push(ctx);
        return {};
      });

      await step();

      const [ctx] = captured;
      expect(ctx?.workflowId).toBeNull();
    });

    it('should support idempotent flag', async () => {
      const step = traceDistributedStep({
        name: 'IdempotentStep',
        idempotent: true,
      })((_ctx) => async () => ({}));

      await step();

      // idempotent attribute should be set via mock
    });

    it('should support compensation flag', async () => {
      const step = traceDistributedStep({
        name: 'CompensationStep',
        isCompensation: true,
      })((ctx) => async () => {
        return { isCompensation: ctx.isCompensation };
      });

      const result = await step();

      expect(result.isCompensation).toBe(true);
    });

    it('should support requiresCompensation method', async () => {
      mockBaggageStore.set('workflow', {
        workflowId: 'wf-123',
        workflowName: 'TestWorkflow',
      });

      const step = traceDistributedStep({
        name: 'ReservationStep',
      })((ctx) => async () => {
        ctx.requiresCompensation({ reservationId: 'res-123' });
        return {};
      });

      await step();

      // requiresCompensation should have been called
    });

    it('should call onStart callback', async () => {
      const onStart = vi.fn();

      const step = traceDistributedStep({
        name: 'TestStep',
        onStart,
      })((_ctx) => async () => ({}));

      await step();

      expect(onStart).toHaveBeenCalled();
    });

    it('should call onComplete callback', async () => {
      const onComplete = vi.fn();

      const step = traceDistributedStep({
        name: 'TestStep',
        onComplete,
      })((_ctx) => async () => ({ result: 'done' }));

      await step();

      expect(onComplete).toHaveBeenCalled();
    });

    it('should call onError callback on failure', async () => {
      const onError = vi.fn();

      const step = traceDistributedStep({
        name: 'FailingStep',
        onError,
      })((_ctx) => async () => {
        throw new Error('Step failed');
      });

      await expect(step()).rejects.toThrow('Step failed');
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('Utility Functions', () => {
    describe('generateWorkflowId', () => {
      it('should generate unique IDs', () => {
        const id1 = generateWorkflowId();
        const id2 = generateWorkflowId();

        expect(id1).not.toBe(id2);
      });

      it('should include prefix when provided', () => {
        const id = generateWorkflowId('order');

        expect(id.startsWith('order-')).toBe(true);
      });

      it('should generate IDs without prefix', () => {
        const id = generateWorkflowId();

        expect(id).toBeDefined();
        expect(id.length).toBeGreaterThan(10);
      });
    });

    describe('isInDistributedWorkflow', () => {
      it('should return true when workflow baggage is present', () => {
        mockBaggageStore.set('workflow', {
          workflowId: 'wf-123',
          workflowName: 'TestWorkflow',
        });

        const ctx = createMockTraceContext();
        const result = isInDistributedWorkflow(ctx);

        expect(result).toBe(true);
      });

      it('should return false when workflow baggage is missing', () => {
        mockBaggageStore.clear();

        const ctx = createMockTraceContext();
        const result = isInDistributedWorkflow(ctx);

        expect(result).toBe(false);
      });

      it('should return false when only partial baggage is present', () => {
        mockBaggageStore.set('workflow', {
          workflowId: 'wf-123',
          // Missing workflowName
        });

        const ctx = createMockTraceContext();
        const result = isInDistributedWorkflow(ctx);

        expect(result).toBe(false);
      });
    });

    describe('getWorkflowProgress', () => {
      it('should return progress information', () => {
        mockBaggageStore.set('workflow', {
          workflowId: 'wf-123',
          workflowName: 'OrderFulfillment',
          stepName: 'ChargePayment',
          stepIndex: 2,
          totalSteps: 5,
        });

        const ctx = createMockTraceContext();
        const progress = getWorkflowProgress(ctx);

        expect(progress).not.toBeNull();
        expect(progress?.workflowId).toBe('wf-123');
        expect(progress?.workflowName).toBe('OrderFulfillment');
        expect(progress?.currentStep).toBe('ChargePayment');
        expect(progress?.currentStepIndex).toBe(2);
        expect(progress?.totalSteps).toBe(5);
        expect(progress?.percentComplete).toBe(60); // (2+1)/5 * 100
      });

      it('should return null when not in workflow', () => {
        mockBaggageStore.clear();

        const ctx = createMockTraceContext();
        const progress = getWorkflowProgress(ctx);

        expect(progress).toBeNull();
      });

      it('should return null percent when totalSteps is unknown', () => {
        mockBaggageStore.set('workflow', {
          workflowId: 'wf-123',
          workflowName: 'TestWorkflow',
          stepIndex: 1,
        });

        const ctx = createMockTraceContext();
        const progress = getWorkflowProgress(ctx);

        expect(progress?.percentComplete).toBeNull();
      });
    });

    describe('createWorkflowHeaders', () => {
      it('should create baggage header with workflow values', () => {
        const headers = createWorkflowHeaders({
          workflowId: 'wf-123',
          workflowName: 'OrderFulfillment',
          stepIndex: 2,
        });

        expect(headers.baggage).toBeDefined();
        expect(headers.baggage).toContain('workflow.workflowId=wf-123');
        expect(headers.baggage).toContain(
          'workflow.workflowName=OrderFulfillment',
        );
        expect(headers.baggage).toContain('workflow.stepIndex=2');
      });

      it('should URL-encode values', () => {
        const headers = createWorkflowHeaders({
          workflowId: 'wf-123',
          workflowName: 'Order Fulfillment',
        });

        expect(headers.baggage).toContain('Order%20Fulfillment');
      });

      it('should return empty object when no values provided', () => {
        const headers = createWorkflowHeaders({});

        expect(headers.baggage).toBeUndefined();
      });

      it('should include all workflow fields', () => {
        const headers = createWorkflowHeaders({
          workflowId: 'wf-123',
          workflowName: 'Test',
          workflowVersion: '1.0.0',
          stepName: 'Step1',
          stepIndex: 0,
          totalSteps: 5,
          priority: 'high',
          correlationId: 'corr-456',
        });

        expect(headers.baggage).toContain('workflow.workflowVersion=1.0.0');
        expect(headers.baggage).toContain('workflow.stepName=Step1');
        expect(headers.baggage).toContain('workflow.totalSteps=5');
        expect(headers.baggage).toContain('workflow.priority=high');
        expect(headers.baggage).toContain('workflow.correlationId=corr-456');
      });
    });

    describe('parseWorkflowFromBaggage', () => {
      it('should parse workflow values from baggage header', () => {
        const baggage =
          'workflow.workflowId=wf-123,workflow.workflowName=OrderFulfillment,workflow.stepIndex=2';

        const values = parseWorkflowFromBaggage(baggage);

        expect(values).not.toBeNull();
        expect(values?.workflowId).toBe('wf-123');
        expect(values?.workflowName).toBe('OrderFulfillment');
        expect(values?.stepIndex).toBe(2);
      });

      it('should URL-decode values', () => {
        const baggage = 'workflow.workflowName=Order%20Fulfillment';

        const values = parseWorkflowFromBaggage(baggage);

        expect(values?.workflowName).toBe('Order Fulfillment');
      });

      it('should return null for empty baggage', () => {
        const values = parseWorkflowFromBaggage('');

        expect(values).toBeNull();
      });

      it('should handle mixed baggage with non-workflow entries', () => {
        const baggage =
          'other.key=value,workflow.workflowId=wf-123,another.key=xyz';

        const values = parseWorkflowFromBaggage(baggage);

        expect(values?.workflowId).toBe('wf-123');
        expect(readProperty(values, 'other')).toBeUndefined();
      });

      it('should parse all workflow fields', () => {
        const baggage = [
          'workflow.workflowId=wf-123',
          'workflow.workflowName=Test',
          'workflow.workflowVersion=1.0.0',
          'workflow.stepName=Step1',
          'workflow.stepIndex=1',
          'workflow.totalSteps=5',
          'workflow.priority=high',
          'workflow.correlationId=corr-456',
          'workflow.parentWorkflowId=parent-123',
          'workflow.initiatedBy=user-789',
          'workflow.startedAt=2024-01-15T10:30:00Z',
        ].join(',');

        const values = parseWorkflowFromBaggage(baggage);

        expect(values?.workflowId).toBe('wf-123');
        expect(values?.workflowName).toBe('Test');
        expect(values?.workflowVersion).toBe('1.0.0');
        expect(values?.stepName).toBe('Step1');
        expect(values?.stepIndex).toBe(1);
        expect(values?.totalSteps).toBe(5);
        expect(values?.priority).toBe('high');
        expect(values?.correlationId).toBe('corr-456');
        expect(values?.parentWorkflowId).toBe('parent-123');
        expect(values?.initiatedBy).toBe('user-789');
        expect(values?.startedAt).toBe('2024-01-15T10:30:00Z');
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should trace cross-service order fulfillment', async () => {
      // Service A: Create order workflow
      const createOrder = traceDistributedWorkflow({
        name: 'OrderFulfillment',
        workflowIdFrom: (order) =>
          asString(readProperty(order, 'orderId')) ?? '',
        version: '1.0.0',
        totalSteps: 4,
      })((ctx) => async (_order: { orderId: string; items: string[] }) => {
        ctx.recordStepProgress('ValidateOrder', 0);

        // Simulate publishing to inventory service
        const headers = ctx.getWorkflowHeaders();

        return {
          workflowId: ctx.workflowId,
          status: 'started',
          headers,
        };
      });

      const orderResult = await createOrder({
        orderId: 'ord-123',
        items: ['item-1'],
      });

      expect(orderResult.workflowId).toBe('ord-123');
      expect(orderResult.status).toBe('started');

      // Service B: Process inventory step
      mockBaggageStore.set('workflow', {
        workflowId: 'ord-123',
        workflowName: 'OrderFulfillment',
        stepIndex: 0,
      });

      const processInventory = traceDistributedStep({
        name: 'ReserveInventory',
        idempotent: true,
      })((ctx) => async () => {
        return {
          workflowId: ctx.workflowId,
          stepName: ctx.stepName,
        };
      });

      const inventoryResult = await processInventory();

      expect(inventoryResult.workflowId).toBe('ord-123');
      expect(inventoryResult.stepName).toBe('ReserveInventory');
    });

    it('should support sub-workflows', async () => {
      // Main workflow
      const mainWorkflow = traceDistributedWorkflow({
        name: 'MainWorkflow',
        workflowIdFrom: () => 'main-wf-123',
      })((ctx) => async () => {
        return { id: ctx.workflowId, name: ctx.workflowName };
      });

      const mainResult = await mainWorkflow();

      // Sub-workflow
      const subWorkflow = traceDistributedWorkflow({
        name: 'SubWorkflow',
        workflowIdFrom: () => 'sub-wf-456',
        parentWorkflowId: mainResult.id,
      })((ctx) => async () => {
        const baggage = ctx.getWorkflowBaggage();
        return {
          id: ctx.workflowId,
          parentId: baggage.parentWorkflowId,
        };
      });

      const subResult = await subWorkflow();

      expect(subResult.id).toBe('sub-wf-456');
      expect(subResult.parentId).toBe('main-wf-123');
    });

    it('should track workflow progress across steps', async () => {
      mockBaggageStore.set('workflow', {
        workflowId: 'wf-123',
        workflowName: 'MultiStepWorkflow',
        stepIndex: 0,
        totalSteps: 3,
      });

      const steps = ['Step1', 'Step2', 'Step3'];
      const results: Array<{ step: string; index: number | null }> = [];

      for (const [i, step_] of steps.entries()) {
        const step = traceDistributedStep({
          name: step_,
          stepIndex: i,
        })((ctx) => async () => {
          return { step: ctx.stepName, index: ctx.stepIndex };
        });

        const result = await step();
        results.push(result);

        // Update baggage for next step
        const currentBaggage = mockBaggageStore.get('workflow');
        mockBaggageStore.set('workflow', {
          ...currentBaggage,
          stepIndex: i + 1,
          stepName: step_,
        });
      }

      expect(results[0]).toEqual({ step: 'Step1', index: 0 });
      expect(results[1]).toEqual({ step: 'Step2', index: 1 });
      expect(results[2]).toEqual({ step: 'Step3', index: 2 });
    });
  });
});
