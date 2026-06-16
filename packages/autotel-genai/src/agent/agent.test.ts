import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_AUDIT_SCHEMA_VERSION,
  createAgentIdentityRegistry,
  createAgentAuditMetadata,
  createSignedEventEnvelope,
  defineAgentAction,
  defineAgentToolCall,
  delegateToAgent,
  hashPayload,
  recordPolicyDecision,
  recordAgentHandoff,
  sanitizeAuditPayload,
  setAgentAttributes,
  verifyEventEnvelopeHash,
  withAgentAction,
  withAgentSession,
  withScopedTool,
  withAgentToolCall,
} from './index.js';
import { buildLifecycleUpdateContext, buildLoggerContext } from './metadata.js';
import { otelTrace } from 'autotel';

const mocked = vi.hoisted(() => {
  const setAttribute = vi.fn();
  const setAttributes = vi.fn();
  const mockCtx = {
    traceId: 'trace-1',
    spanId: 'span-1',
    correlationId: 'corr-1',
    setAttribute,
    setAttributes,
  };

  const logger = {
    set: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getContext: vi.fn(() => ({})),
    emitNow: vi.fn(() => ({
      timestamp: new Date().toISOString(),
      traceId: 'trace-1',
      spanId: 'span-1',
      correlationId: 'corr-1',
      context: {},
    })),
    fork: vi.fn(),
  };

  return {
    setAttribute,
    setAttributes,
    mockCtx,
    logger,
    forceKeepAuditEvent: vi.fn(),
    withAudit: vi.fn(
      async (
        _metadata: unknown,
        fn: (ctx: typeof mockCtx, logger: typeof logger) => unknown,
        options?: { ctx?: typeof mockCtx },
      ) => fn(options?.ctx ?? mockCtx, logger),
    ),
  };
});

const { forceKeepAuditEvent, logger, mockCtx, setAttribute, setAttributes, withAudit } =
  mocked;

vi.mock('autotel', () => ({
  createStructuredError: vi.fn((input: { message: string } & Record<string, unknown>) =>
    Object.assign(new Error(input.message), input),
  ),
  getTraceContext: vi.fn(() => mocked.mockCtx),
  getRequestLogger: vi.fn(() => mocked.logger),
  getRequestLoggerSafe: vi.fn(() => mocked.logger),
  createNoopRequestLogger: vi.fn(() => mocked.logger),
  GEN_AI_COST_ATTRIBUTE: 'gen_ai.usage.cost.usd',
  estimateLLMCost: vi.fn(
    (_model: string, usage: { inputTokens?: number; outputTokens?: number }) =>
      ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)) / 1000,
  ),
  otelTrace: {
    getActiveSpan: vi.fn(() => ({
      setAttribute: mocked.setAttribute,
      setAttributes: mocked.setAttributes,
      spanContext: () => ({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
      }),
    })),
  },
}));

vi.mock('autotel-audit', () => ({
  forceKeepAuditEvent: mocked.forceKeepAuditEvent,
  withAudit: mocked.withAudit,
}));

describe('autotel-genai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hashPayload is deterministic across object key order', () => {
    expect(hashPayload({ b: 2, a: 1 })).toBe(hashPayload({ a: 1, b: 2 }));
  });

  it('delegateToAgent appends authority lineage and computes stable lineage metadata', () => {
    const delegation = delegateToAgent({
      parentIdentity: 'user_123',
      targetAgentId: 'planner',
      scope: ['travel:plan'],
      authorityLineage: ['session_root', 'router'],
    });

    expect(delegation.authorityLineage).toEqual([
      'session_root',
      'router',
      'planner',
    ]);
    expect(delegation.authorityLineageHash).toMatch(/^sha256:/);
    expect(delegation.depth).toBe(2);
    expect(delegation.issuedAt).toBeDefined();
  });

  it('createAgentAuditMetadata applies schema defaults and validates strict event requirements', () => {
    const metadata = createAgentAuditMetadata({
      action: 'agent.plan',
      agent: { id: 'planner' },
    });

    expect(metadata.schemaVersion).toBe(AGENT_AUDIT_SCHEMA_VERSION);
    expect(metadata.eventKind).toBe('action');

    expect(() =>
      createAgentAuditMetadata({
        action: 'agent.tool',
        eventKind: 'tool_call',
        agent: { id: 'planner' },
      }),
    ).toThrow(/requires metadata.tool/);
  });

  it('setAgentAttributes writes normalized agent, delegation, tool, and policy attributes', () => {
    setAgentAttributes(
      {
        action: 'agent.refund.handle',
        resource: 'refund',
        agent: {
          id: 'refunds-specialist',
          version: '2026-06-13',
          framework: 'openai-agents',
          role: 'specialist',
        },
        delegation: {
          parentIdentity: 'user_123',
          scope: ['refund:write'],
          tokenId: 'jti_1',
          delegationId: 'dlg_1',
          authorityLineage: ['user_123', 'refunds-specialist'],
          authorityLineageHash: hashPayload(['user_123', 'refunds-specialist']),
          depth: 1,
        },
        tool: {
          name: 'stripe_refund_v3',
          input: { refundId: 're_123' },
        },
        policy: {
          decision: 'permit',
          policyId: 'refund-guardrail-v1',
          riskScore: 0.08,
        },
        reasoningSummary: 'Refund is permitted under current policy.',
      },
      mockCtx,
    );

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'autotel.agent': true,
        'agent.action': 'agent.refund.handle',
        'agent.audit.version': AGENT_AUDIT_SCHEMA_VERSION,
        'agent.event.kind': 'tool_call',
        'agent.id': 'refunds-specialist',
        'delegation.parent_identity': 'user_123',
        'delegation.scope': ['refund:write'],
        'delegation.id': 'dlg_1',
        'delegation.authority_lineage_hash': expect.stringMatching(/^sha256:/),
        'delegation.depth': 1,
        'tool.name': 'stripe_refund_v3',
        'tool.input_hash': expect.stringMatching(/^sha256:/),
        'policy.decision': 'permit',
        'policy.id': 'refund-guardrail-v1',
        'policy.risk_score': 0.08,
        'reasoning.summary': 'Refund is permitted under current policy.',
      }),
    );
  });

  it('withAgentAction tags success and updates logger context', async () => {
    const result = await withAgentAction(
      {
        action: 'agent.plan_trip',
        resource: 'itinerary',
        agent: {
          id: 'tripmate',
          version: 'v1',
        },
        delegation: {
          parentIdentity: 'user_42',
        },
        governance: {
          reviewRequired: true,
          lifecycleStage: 'operate',
        },
      },
      async () => 'ok',
      { emitNow: true },
    );

    expect(result).toBe('ok');
    expect(withAudit).toHaveBeenCalledTimes(1);
    expect(logger.set).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          id: 'tripmate',
          version: 'v1',
          resource: 'itinerary',
          schemaVersion: AGENT_AUDIT_SCHEMA_VERSION,
          eventKind: 'action',
        }),
      }),
    );
    // Completion stamps only the outcome delta so it can't clobber richer
    // state a nested step (e.g. a tool call) already wrote — on both the span
    // and the correlated wide event (bare actions included).
    expect(setAttribute).toHaveBeenCalledWith('agent.outcome', 'success');
    expect(logger.set).toHaveBeenCalledWith({ agent: { outcome: 'success' } });
  });

  it('buildLoggerContext returns a deep copy so logger.set() cannot mutate span metadata', () => {
    // The request logger deep-merges and concatenates array fields across
    // calls. Lifecycle wrappers call .set() more than once with the same
    // delegation object, so the logger payload must not share references with
    // the metadata that setAgentAttributes() writes to the span.
    const lineage = ['user_123', 'router'];
    const policyIds = ['p1'];
    const metadata = createAgentAuditMetadata({
      action: 'agent.act',
      agent: { id: 'a1' },
      delegation: { parentIdentity: 'user_123', authorityLineage: lineage },
      decision: { summary: 's', policyIds },
    });

    const ctx = buildLoggerContext(metadata) as {
      delegation: { authorityLineage: string[] };
      decision: { policyIds: string[] };
    };

    expect(ctx.delegation.authorityLineage).toEqual(lineage);
    expect(ctx.delegation.authorityLineage).not.toBe(lineage);
    expect(ctx.delegation).not.toBe(metadata.delegation);
    expect(ctx.decision.policyIds).not.toBe(policyIds);

    // Simulate the logger's in-place array concatenation; the source arrays
    // must be untouched.
    ctx.delegation.authorityLineage.push('mutated');
    expect(lineage).toEqual(['user_123', 'router']);
    expect(metadata.delegation?.authorityLineage).toEqual(['user_123', 'router']);
  });

  it('buildLifecycleUpdateContext sends only the domain delta, omitting request-level arrays', () => {
    // The completion .set() must not re-send delegation/decision: those carry
    // arrays the wide-event logger would concatenate (double) on each call.
    // Outcome is owned by withAgentAction, so it is not re-sent here either.
    const ctx = buildLifecycleUpdateContext(
      createAgentAuditMetadata({
        action: 'agent.tool_call',
        agent: { id: 'a1' },
        outcome: 'success',
        delegation: { parentIdentity: 'u1', authorityLineage: ['u1', 'r'] },
        decision: { summary: 's', policyIds: ['p1'] },
        tool: { name: 't', inputHash: 'sha256:x', status: 'complete' },
      }),
    );

    expect(ctx).toEqual({
      tool: expect.objectContaining({ name: 't', status: 'complete' }),
    });
    expect(ctx).not.toHaveProperty('delegation');
    expect(ctx).not.toHaveProperty('decision');
    expect(ctx).not.toHaveProperty('agent');
  });

  it('recordPolicyDecision force-keeps and emits immediately when requested', () => {
    recordPolicyDecision(
      {
        action: 'agent.guardrail',
        resource: 'travel_request',
        agent: { id: 'tripmate' },
        policy: {
          decision: 'deny',
          policyId: 'travel-scope-v1',
          reason: 'off_topic',
        },
      },
      { emitNow: true },
    );

    expect(forceKeepAuditEvent).toHaveBeenCalledTimes(1);
    expect(logger.emitNow).toHaveBeenCalledTimes(1);
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'policy.decision': 'deny',
        'policy.id': 'travel-scope-v1',
        'policy.reason': 'off_topic',
      }),
    );
  });

  it('recordPolicyDecision degrades gracefully (warn) when no trace context', () => {
    vi.mocked(otelTrace.getActiveSpan).mockReturnValueOnce(undefined as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() =>
      recordPolicyDecision({
        action: 'agent.guardrail.nocontext',
        agent: { id: 'tripmate' },
        policy: { decision: 'deny' },
      }),
    ).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(forceKeepAuditEvent).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('recordPolicyDecision throws when onMissingContext is "throw" and no context', () => {
    vi.mocked(otelTrace.getActiveSpan).mockReturnValueOnce(undefined as never);

    expect(() =>
      recordPolicyDecision(
        {
          action: 'agent.guardrail.throw',
          agent: { id: 'tripmate' },
          policy: { decision: 'deny' },
        },
        { onMissingContext: 'throw' },
      ),
    ).toThrow('No active trace context');
  });

  it('withAgentToolCall records GenAI cost + token attributes from extractUsage', async () => {
    await withAgentToolCall(
      {
        action: 'agent.research',
        resource: 'evidence',
        agent: { id: 'researcher' },
        tool: { name: 'gpt-4o' },
        ai: { model: 'gpt-4o', operation: 'chat', finishReasons: ['stop'] },
      },
      async () => ({ text: 'ok', usage: { inputTokens: 1000, outputTokens: 500 } }),
      {
        ctx: mockCtx,
        extractUsage: (result) =>
          (result as { usage: { inputTokens: number; outputTokens: number } }).usage,
      },
    );

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.operation.name': 'chat',
        'gen_ai.response.finish_reasons': ['stop'],
        'gen_ai.usage.input_tokens': 1000,
        'gen_ai.usage.output_tokens': 500,
        // Real cost from MODEL_PRICING['gpt-4o']: 1000@2.5/1M + 500@10/1M.
        'gen_ai.usage.cost.usd': 0.0075,
      }),
    );
  });

  it('withAgentAction records GenAI request model from static ai.usage, no cost when model unknown is still attempted', async () => {
    await withAgentAction(
      {
        action: 'agent.embed',
        agent: { id: 'embedder' },
        ai: { model: 'text-embedding-3-small', usage: { inputTokens: 200 } },
      },
      async () => 'done',
      { ctx: mockCtx },
    );

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.request.model': 'text-embedding-3-small',
        'gen_ai.usage.input_tokens': 200,
      }),
    );
  });

  it('withAgentAction without ai metadata records no GenAI attributes', async () => {
    await withAgentAction(
      { action: 'agent.plain', agent: { id: 'a1' } },
      async () => 'done',
      { ctx: mockCtx },
    );

    const sawGenAi = setAttributes.mock.calls.some(([attrs]) =>
      Object.keys(attrs as Record<string, unknown>).some((k) => k.startsWith('gen_ai.')),
    );
    expect(sawGenAi).toBe(false);
  });

  it('recordAgentHandoff records a canonical handoff event with derived delegation lineage', () => {
    recordAgentHandoff(
      {
        action: 'agent.handoff',
        fromAgent: { id: 'router' },
        toAgent: { id: 'specialist' },
        parentIdentity: 'user_123',
        scope: ['refund:write'],
        authorityLineage: ['user_123', 'router'],
        governance: {
          reviewRequired: true,
          controlId: ['govern-2.1', 'map-3.5'],
          lifecycleStage: 'operate',
        },
      },
      { forceKeep: false },
    );

    expect(logger.set).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          id: 'specialist',
          eventKind: 'handoff',
        }),
        governance: expect.objectContaining({
          reviewRequired: true,
          controlId: ['govern-2.1', 'map-3.5'],
        }),
      }),
    );
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'agent.event.kind': 'handoff',
        'delegation.authority_lineage': ['user_123', 'router', 'specialist'],
        'delegation.depth': 2,
        'governance.lifecycle_stage': 'operate',
      }),
    );
  });

  it('recordAgentHandoff keeps the source agent queryable when no lineage is supplied', () => {
    // Without an explicit lineage the "from" agent must still land in the
    // canonical delegation.authority_lineage, not only the free-text summary.
    recordAgentHandoff(
      {
        action: 'agent.handoff',
        fromAgent: { id: 'router' },
        toAgent: { id: 'specialist' },
        parentIdentity: 'user_123',
      },
      { forceKeep: false },
    );

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'delegation.authority_lineage': ['user_123', 'router', 'specialist'],
      }),
    );
  });

  it('withAgentToolCall hashes tool input and result, then marks complete', async () => {
    const result = await withAgentToolCall(
      {
        action: 'agent.tool_call',
        resource: 'stripe_refund_v3',
        agent: { id: 'refunds-specialist' },
        tool: {
          name: 'stripe_refund_v3',
          input: { refundId: 're_123' },
        },
      },
      async () => ({ status: 'complete', refundId: 're_123' }),
    );

    expect(result).toEqual({ status: 'complete', refundId: 're_123' });
    expect(logger.set).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: expect.objectContaining({
          name: 'stripe_refund_v3',
          inputHash: expect.stringMatching(/^sha256:/),
          outputHash: expect.stringMatching(/^sha256:/),
          status: 'complete',
        }),
      }),
    );
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'tool.status': 'complete',
        'tool.output_hash': expect.stringMatching(/^sha256:/),
      }),
    );
  });

  it('withAgentToolCall completion does not clobber tool.status back to planned', async () => {
    // Regression: withAgentAction's completion used to re-flatten the whole
    // (stale) metadata, overwriting the tool_call's `complete` status with the
    // `planned` it started with. Completion must stamp only the outcome delta.
    await withAgentToolCall(
      {
        action: 'agent.tool_call',
        agent: { id: 'a1' },
        tool: { name: 'stripe_refund_v3', input: { refundId: 're_1' } },
      },
      async () => ({ ok: true }),
    );

    const toolStatusWrites = setAttributes.mock.calls
      .map(([attrs]) => (attrs as Record<string, unknown>)['tool.status'])
      .filter((status): status is string => status !== undefined);
    expect(toolStatusWrites.at(-1)).toBe('complete');
    expect(setAttribute).toHaveBeenCalledWith('agent.outcome', 'success');
  });

  it('defineAgentToolCall builds a reusable wrapper that hashes per-call input', async () => {
    const handleRefund = defineAgentToolCall(
      (req: { refundId: string }) => ({
        action: 'agent.refund.tool_call',
        resource: 'stripe_refund_v3',
        agent: { id: 'refunds-specialist' },
        tool: { name: 'stripe_refund_v3', input: { refundId: req.refundId } },
      }),
      (ctx) => async (req: { refundId: string }) => {
        ctx.setAttribute('refund.id', req.refundId);
        return { status: 'complete', refundId: req.refundId };
      },
    );

    const first = await handleRefund({ refundId: 're_1' });
    const second = await handleRefund({ refundId: 're_2' });

    expect(first).toEqual({ status: 'complete', refundId: 're_1' });
    expect(second).toEqual({ status: 'complete', refundId: 're_2' });
    expect(setAttribute).toHaveBeenCalledWith('refund.id', 're_1');
    expect(setAttribute).toHaveBeenCalledWith('refund.id', 're_2');

    // Distinct inputs must produce distinct recorded hashes (per-call hashing).
    const inputHashes = setAttributes.mock.calls
      .map(([attrs]) => (attrs as Record<string, unknown>)['tool.input_hash'])
      .filter((hash): hash is string => typeof hash === 'string');
    expect(new Set(inputHashes).size).toBe(2);
  });

  it('defineAgentAction wraps a reusable action with static metadata', async () => {
    const planTrip = defineAgentAction(
      { action: 'agent.trip.plan', agent: { id: 'planner' } },
      (ctx) => async (destination: string) => {
        ctx.setAttribute('trip.destination', destination);
        return `itinerary:${destination}`;
      },
    );

    const result = await planTrip('Lisbon');

    expect(result).toBe('itinerary:Lisbon');
    expect(setAttribute).toHaveBeenCalledWith('trip.destination', 'Lisbon');
    expect(setAttribute).toHaveBeenCalledWith('agent.outcome', 'success');
  });

  it('withAgentSession records session lifecycle state transitions', async () => {
    const result = await withAgentSession(
      {
        action: 'agent.session',
        agent: {
          id: 'tripmate',
          sessionId: 'sess_123',
        },
        session: {
          delegatedBy: 'user_42',
        },
      },
      async () => 'ready',
    );

    expect(result).toBe('ready');
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'agent.session.status': 'completed',
        'agent.session.delegated_by': 'user_42',
      }),
    );
    expect(logger.set).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          status: 'completed',
        }),
      }),
    );
  });

  it('createAgentIdentityRegistry tracks lifecycle and issues scoped delegations', () => {
    const registry = createAgentIdentityRegistry([
      {
        agent: { id: 'refund-specialist', role: 'specialist' },
        scopes: ['refund:write', 'customer:read'],
        tokenId: 'jti_55102',
      },
    ]);

    expect(registry.getIdentityStatus('refund-specialist')).toBe('active');
    const rotated = registry.rotateIdentity('refund-specialist', {
      tokenId: 'jti_55103',
    });
    expect(rotated.status).toBe('rotated');
    expect(rotated.tokenHash).toMatch(/^sha256:/);

    const delegation = registry.issueDelegation('refund-specialist', {
      parentIdentity: 'usr_99824',
      scope: ['refund:write'],
      authorityLineage: ['usr_99824', 'router'],
    });

    expect(delegation.authorityLineage).toEqual([
      'usr_99824',
      'router',
      'refund-specialist',
    ]);

    registry.revokeIdentity('refund-specialist', {
      reason: 'rotation failed',
    });
    expect(registry.getIdentityStatus('refund-specialist')).toBe('revoked');
  });

  it('sanitizeAuditPayload applies strict privacy defaults', () => {
    expect(
      sanitizeAuditPayload({
        email: 'alice@example.com',
        apiToken: 'secret-token',
        customerName: 'Alice Johnson',
        message:
          'This is a very long prompt body that should be masked rather than copied into an audit sink.',
      }),
    ).toEqual({
      email: expect.stringMatching(/^sha256:/),
      apiToken: '<redacted>',
      customerName: expect.stringMatching(/^sha256:/),
      message: 'Thi***nk.',
    });
  });

  it('createSignedEventEnvelope produces a verifiable chained envelope', async () => {
    const envelope = await createSignedEventEnvelope(
      {
        action: 'agent.tool_call',
        agent: { id: 'analytics-bot' },
        tool: {
          name: 'query_warehouse',
          input: { accountId: 'acct_123' },
        },
      },
      {
        previousEventHash: 'sha256:prev',
        evidence: {
          apiToken: 'secret-token',
          patientName: 'Alice Example',
        },
        privacyProfile: 'healthcare',
        signer: async (serialized) => `sig:${serialized.length}`,
      },
    );

    expect(envelope.previousEventHash).toBe('sha256:prev');
    expect(envelope.signature).toMatch(/^sig:/);
    expect(envelope.eventHash).toMatch(/^sha256:/);
    expect(verifyEventEnvelopeHash(envelope)).toBe(true);
    expect(envelope.evidence).toEqual({
      apiToken: '<redacted>',
      patientName: expect.stringMatching(/^sha256:/),
    });
  });

  it('withScopedTool denies execution when required scopes are missing', async () => {
    const registry = createAgentIdentityRegistry([
      {
        agent: { id: 'tripmate' },
        scopes: ['travel:read'],
      },
    ]);

    await expect(
      withScopedTool(
        {
          action: 'agent.travel.book',
          agent: { id: 'tripmate' },
          tool: { name: 'book_flight' },
          requiredScopes: ['travel:write'],
          policyId: 'travel-scope-v2',
          identityRegistry: registry,
          delegation: {
            parentIdentity: 'user_42',
            scope: ['travel:read'],
          },
          decision: {
            summary: 'Attempted flight booking.',
            policyIds: ['travel-scope-v2'],
          },
        },
        { destination: 'LIS' },
        async () => 'should not run',
      ),
    ).rejects.toMatchObject({
      code: 'AGENT_SCOPE_DENIED',
      status: 403,
    });

    expect(logger.set).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({
          decision: 'deny',
          policyId: 'travel-scope-v2',
        }),
      }),
    );
  });

  it('withScopedTool denies a delegation that claims scopes beyond the registry grant', async () => {
    // Security regression: an explicit delegation.scope must not be able to
    // escalate past what the registry actually granted the identity.
    const registry = createAgentIdentityRegistry([
      {
        agent: { id: 'tripmate' },
        scopes: ['travel:read'],
      },
    ]);

    let executed = false;
    await expect(
      withScopedTool(
        {
          action: 'agent.travel.book',
          agent: { id: 'tripmate' },
          tool: { name: 'book_flight' },
          requiredScopes: ['travel:write'],
          policyId: 'travel-scope-v2',
          identityRegistry: registry,
          // Forged: identity only holds travel:read in the registry.
          delegation: {
            parentIdentity: 'user_42',
            scope: ['travel:write'],
          },
        },
        { destination: 'LIS' },
        async () => {
          executed = true;
          return 'should not run';
        },
      ),
    ).rejects.toMatchObject({
      code: 'AGENT_SCOPE_DENIED',
      status: 403,
    });

    expect(executed).toBe(false);
    expect(logger.set).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({
          decision: 'deny',
          reason: 'unauthorized_scope:travel:write',
        }),
      }),
    );
  });

  it('supports fake-agent tests without real model calls', async () => {
    const refusal =
      'TripMate: I can only help with safe travel and trip planning.';

    type Responder = { generate(options: { prompt: string }): Promise<{ text: string }> };

    function fakeAgent(text: string): Responder {
      return { generate: vi.fn(async () => ({ text })) };
    }

    async function handle(
      query: string,
      agents: { guardrail?: Responder; tripmate?: Responder } = {},
    ): Promise<string> {
      return withAgentAction(
        {
          action: 'agent.travel.handle',
          resource: 'travel_request',
          agent: {
            id: 'tripmate',
            version: 'test',
            role: 'planner',
          },
          delegation: {
            parentIdentity: 'user_99824',
            scope: ['travel:plan'],
          },
        },
        async () => {
          const guardrail = agents.guardrail ?? fakeAgent('0');
          const tripmate = agents.tripmate ?? fakeAgent('real network should not happen');
          const check = await guardrail.generate({ prompt: query });

          if (!check.text.trim().startsWith('1')) {
            recordPolicyDecision(
              {
                action: 'agent.travel.guardrail',
                resource: 'travel_request',
                agent: { id: 'tripmate' },
                policy: {
                  decision: 'deny',
                  policyId: 'travel-scope-v1',
                  reason: 'off_topic',
                },
              },
              { forceKeep: false },
            );
            return refusal;
          }

          recordPolicyDecision(
            {
              action: 'agent.travel.guardrail',
              resource: 'travel_request',
              agent: { id: 'tripmate' },
              policy: {
                decision: 'permit',
                policyId: 'travel-scope-v1',
              },
            },
            { forceKeep: false },
          );

          const response = await withAgentToolCall(
            {
              action: 'agent.travel.reply',
              resource: 'tripmate.generate',
              agent: { id: 'tripmate' },
              tool: {
                name: 'tripmate.generate',
                input: { prompt: query },
              },
            },
            async () => tripmate.generate({ prompt: query }),
            { hashResult: false },
          );

          return response.text;
        },
      );
    }

    const blocked = await handle('Write me a poem about cats.', {
      guardrail: fakeAgent('0'),
    });
    expect(blocked).toBe(refusal);

    const tripmate = fakeAgent('A lovely long weekend in Lisbon.');
    const allowed = await handle('Plan me a weekend in Lisbon.', {
      guardrail: fakeAgent('1'),
      tripmate,
    });
    expect(allowed).toBe('A lovely long weekend in Lisbon.');
    expect(tripmate.generate).toHaveBeenCalledTimes(1);
  });
});
