# AI/LLM Workflow Patterns with Autotel

This guide demonstrates how to instrument AI/LLM applications using Autotel's existing APIs. All patterns shown leverage standard OpenTelemetry primitives and work seamlessly with OpenLLMetry's automatic LLM instrumentation.

## Table of Contents

- [Overview](#overview)
- [When to Use OpenLLMetry](#when-to-use-openllmetry)
  - [Decision Criteria](#decision-criteria)
  - [What Each Approach Provides](#what-each-approach-provides)
  - [Best Practice: Use Both Together](#best-practice-use-both-together)
- [Quick Reference](#quick-reference)
  - [Setup](#setup)
  - [Essential Patterns](#essential-patterns)
  - [Semantic Conventions](#semantic-conventions)
  - [Key Takeaways](#key-takeaways)
- [Core Concepts](#core-concepts)
  - [Correlation IDs](#correlation-ids)
  - [Multi-Step Workflows](#multi-step-workflows)
  - [Domain Events](#domain-events)
- [Pattern: Multi-Agent Workflows](#pattern-multi-agent-workflows)
- [Pattern: RAG Pipelines](#pattern-rag-pipelines)
- [Pattern: Streaming Responses](#pattern-streaming-responses)
- [Pattern: Evaluation Loops](#pattern-evaluation-loops)
- [AI Semantic Conventions](#ai-semantic-conventions)
- [Complete Examples](#complete-examples)

## Overview

Autotel provides all the building blocks needed for comprehensive AI/LLM observability:

- **Automatic LLM instrumentation** via OpenLLMetry integration
- **Workflow orchestration** via nested `trace()` calls
- **Context propagation** via AsyncLocalStorage (correlation IDs, user context, etc.)
- **Business event tracking** via `ctx.setAttribute()` and `track()`
- **Multi-destination events** via adapters (PostHog, Mixpanel, etc.)

**Key Insight**: Autotel's functional API patterns work perfectly for AI workflows - no special "AI-specific" APIs needed!

## When to Use OpenLLMetry

[OpenLLMetry](https://github.com/traceloop/openllmetry-js) provides automatic instrumentation for LLM API calls, while autotel's `trace()` function handles workflow orchestration and business metrics. Understanding when to use each - or both together - helps you build comprehensive AI observability.

### Decision Criteria

| Use Case | Recommendation | Why |
|----------|---------------|-----|
| **Using LLM SDKs** (OpenAI, Anthropic, Langchain, Vercel AI SDK, etc.) | ✅ **Enable OpenLLMetry** | Automatic capture of prompts, completions, tokens, model params without manual instrumentation |
| **Custom LLM integrations** (direct HTTP calls, custom models) | ⚠️ **Manual `trace()` only** | OpenLLMetry won't detect custom integrations - use `trace()` with AI semantic conventions |
| **Workflow orchestration** (multi-agent, RAG pipelines, evaluation loops) | ✅ **Always use `trace()`** | Critical for tracking workflow steps, handoffs, business logic - OpenLLMetry doesn't capture this |
| **Business metrics** (user engagement, escalations, feedback loops) | ✅ **Always use `trace()` + `track()`** | Domain events require explicit instrumentation regardless of LLM library |
| **Production applications** | ✅ **Use both together** | OpenLLMetry handles LLM internals, `trace()` handles everything else |

### What Each Approach Provides

#### OpenLLMetry Automatic Instrumentation

When enabled via `init({ openllmetry: { enabled: true } })`, OpenLLMetry automatically captures:

```typescript
// Example: Using Vercel AI SDK
import { generateText } from 'ai';

// OpenLLMetry automatically instruments this call - zero code changes needed!
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Explain quantum computing',
});

// Automatic span attributes captured:
// - llm.request.model: "gpt-4o"
// - llm.provider: "openai"
// - llm.request.temperature: 0.7
// - llm.usage.prompt_tokens: 45
// - llm.usage.completion_tokens: 128
// - llm.usage.total_tokens: 173
// - llm.prompts.0.content: "Explain quantum computing"
// - llm.completions.0.content: "[full response text]"
```

**What you get automatically:**

- ✅ LLM API request/response details (prompts, completions, model parameters)
- ✅ Token usage tracking (prompt, completion, total)
- ✅ Timing and latency for each LLM call
- ✅ Error capture for failed LLM requests
- ✅ Support for streaming responses
- ✅ Works with 20+ LLM providers/SDKs (OpenAI, Anthropic, Langchain, LlamaIndex, Vercel AI SDK, etc.)

**What you DON'T get:**

- ❌ Business workflow context (which agent? which step? why called?)
- ❌ Business metrics (escalations, user satisfaction, custom events)
- ❌ Correlation across workflow steps
- ❌ Custom attributes for your domain logic

#### Manual `trace()` Instrumentation

Using autotel's `trace()` function provides full control over observability:

```typescript
import { trace } from 'autotel';

const triageAgent = trace('agent.triage', ctx => async (input: string) => {
  // Business context
  ctx.setAttributes({
    'agent.role': 'triage',
    'agent.purpose': 'route_to_specialist',
    'workflow.step': 1,
  });

  // Call LLM (OpenLLMetry will auto-instrument this call)
  const result = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `Triage this request: ${input}`,
  });

  // Business metrics
  const requiresEscalation = result.text.includes('ESCALATE');
  ctx.setAttribute('triage.escalation_required', requiresEscalation);

  return { decision: result.text, escalate: requiresEscalation };
});
```

**What you get with `trace()`:**

- ✅ Named workflow steps (clear span names like "agent.triage")
- ✅ Business attributes (agent roles, workflow state, custom logic)
- ✅ Correlation IDs automatically propagated
- ✅ Parent-child span relationships for complex workflows
- ✅ Integration with events via `track()` events
- ✅ Works with ANY code (LLM or non-LLM)

### Best Practice: Use Both Together

The most powerful approach combines OpenLLMetry's automatic LLM instrumentation with autotel's workflow orchestration:

```typescript
import { init, trace, track } from 'autotel';

// 1. Enable both at initialization
init({
  service: 'customer-support-ai',
  endpoint: process.env.OTLP_ENDPOINT,
  openllmetry: {
    enabled: true, // ← Enables automatic LLM instrumentation
    options: {
      disableBatch: process.env.NODE_ENV !== 'production',
    },
  },
});

// 2. Use trace() for workflow orchestration
const handleCustomerQuery = trace('workflow.customer_query', ctx => async (query: string, userId: string) => {
  // Workflow-level context
  ctx.setAttributes({
    'workflow.type': 'customer_support',
    'user.id': userId,
  });

  // Step 1: Triage (trace() creates span, OpenLLMetry instruments LLM call inside)
  const triage = await trace('step.triage', async () => {
    // OpenLLMetry automatically instruments this generateText() call
    return await generateText({
      model: openai('gpt-4o-mini'),
      prompt: `Triage: ${query}`,
    });
  });

  ctx.setAttribute('triage.category', triage.text);

  // Business logic decides next step
  const needsEscalation = triage.text.includes('ESCALATE');

  if (needsEscalation) {
    // Step 2: Specialist (another span with auto-instrumented LLM)
    const specialist = await trace('step.specialist', async () => {
      return await generateText({
        model: openai('gpt-4o'), // More capable model
        prompt: `Expert response needed: ${query}`,
      });
    });

    // Track business event
    track('escalation_occurred', {
      category: triage.text,
      userId,
      correlationId: ctx.correlationId,
    });

    return { response: specialist.text, escalated: true };
  }

  return { response: triage.text, escalated: false };
});
```

**What you get with both:**

```text
Trace Tree:
workflow.customer_query (trace)
├─ user.id: "user123"
├─ workflow.type: "customer_support"
├─ correlation.id: "abc-123-def"
│
├─ step.triage (trace)
│  ├─ llm.chat (OpenLLMetry auto-span) ← Automatic!
│  │  ├─ llm.request.model: "gpt-4o-mini"
│  │  ├─ llm.usage.prompt_tokens: 23
│  │  ├─ llm.usage.completion_tokens: 45
│  │  └─ llm.prompts.0.content: "Triage: ..."
│  └─ triage.category: "billing_issue"
│
└─ step.specialist (trace)
   ├─ llm.chat (OpenLLMetry auto-span) ← Automatic!
   │  ├─ llm.request.model: "gpt-4o"
   │  ├─ llm.usage.prompt_tokens: 78
   │  ├─ llm.usage.completion_tokens: 234
   │  └─ llm.prompts.0.content: "Expert response needed: ..."
   └─ escalated: true

Events Event:
escalation_occurred
├─ category: "billing_issue"
├─ userId: "user123"
└─ correlationId: "abc-123-def" ← Automatic correlation!
```

**Key benefits of combining both:**

1. **Zero-effort LLM telemetry**: OpenLLMetry captures all SDK calls automatically
2. **Business context**: `trace()` adds workflow meaning and business logic
3. **Perfect correlation**: All spans and events share the same correlation ID
4. **Complete picture**: See both "what the LLM did" (OpenLLMetry) and "why it did it" (your trace spans)
5. **Events integration**: Business events automatically correlated with technical traces

### Setup Guide

#### Option 1: OpenLLMetry Only (Not Recommended)

If you only enable OpenLLMetry without using `trace()`, you'll get LLM call details but miss business context:

```typescript
import { init } from 'autotel';

init({
  service: 'my-ai-app',
  openllmetry: { enabled: true },
});

// You'll see LLM spans but no workflow context
const result = await generateText({ model: openai('gpt-4o'), prompt: 'test' });
// ❌ No way to know: which agent? which step? which user? why called?
```

#### Option 2: Manual trace() Only (Good for Custom Models)

If you're using custom LLM integrations or direct HTTP calls:

```typescript
import { trace } from 'autotel';

const callCustomLLM = trace('llm.custom_model', ctx => async (prompt: string) => {
  ctx.setAttributes({
    'llm.model': 'my-custom-model-v2',
    'llm.provider': 'self-hosted',
    'llm.prompt': prompt,
  });

  const response = await fetch('https://my-llm-api.com/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });

  const data = await response.json();
  ctx.setAttributes({
    'llm.completion': data.text,
    'llm.tokens': data.usage.totalTokens,
  });

  return data.text;
});
```

#### Option 3: Both Together (Recommended)

For production applications using LLM SDKs:

```typescript
import { init, trace } from 'autotel';

init({
  service: 'production-ai-app',
  openllmetry: { enabled: true }, // ← Auto-instrument LLM SDKs
});

// Your workflow code uses trace() for business logic
const workflow = trace('workflow.main', ctx => async (input: string) => {
  // OpenLLMetry will auto-instrument any LLM calls inside
  // trace() provides workflow context and business metrics
  // Both appear as child spans in the same trace tree
});
```

### Quick Decision Tree

```text
Are you using LLM SDKs (OpenAI, Anthropic, Vercel AI SDK, Langchain)?
├─ Yes
│  └─ Enable OpenLLMetry ✅
│     └─ Do you need business context/metrics?
│        ├─ Yes → Also use trace() ✅ (RECOMMENDED)
│        └─ No → OpenLLMetry only (you'll regret this later)
│
└─ No (custom models, direct HTTP)
   └─ Use trace() only ✅
      └─ Add AI semantic conventions manually
```

### Real-World Examples

#### Multi-Agent Workflow with OpenLLMetry

See `apps/example-ai-agent/src/multi-agent-workflow-with-openllmetry.ts` for a complete example showing:

- OpenLLMetry enabled in `init()` - single configuration point
- Multi-agent workflow using `trace()` for business context
- @openai/agents framework for agent orchestration
- Real OpenAI SDK calls (via Ollama) auto-instrumented by OpenLLMetry
- Business metrics and events integration
- Full correlation across all spans and events

Compare with `apps/example-ai-agent/src/multi-agent-workflow.ts` which uses simulated LLM calls (no OpenLLMetry needed).

#### RAG Pipeline

See `apps/example-ai-agent/src/rag-pipeline.ts` for a complete RAG pipeline example showing:

- Embeddings generation tracking
- Vector search observability
- Context assembly monitoring
- LLM generation with retrieved context
- End-to-end pipeline metrics

## Quick Reference

### Setup

```typescript
import { init } from 'autotel';

init({
  service: 'my-ai-app',
  endpoint: process.env.OTLP_ENDPOINT,
  // Optional: Enable automatic LLM instrumentation
  openllmetry: {
    enabled: true,
    options: {
      disableBatch: process.env.NODE_ENV !== 'production',
    },
  },
});
```

### Essential Patterns

#### 1. Basic AI Operation

```typescript
import { trace } from 'autotel';

const generateResponse = trace('ai.generate', ctx => async (prompt: string) => {
  ctx.setAttributes({
    'ai.model': 'gpt-4o',
    'ai.provider': 'openai',
  });

  const response = await llm.generate(prompt);
  ctx.setAttribute('ai.tokens', response.usage.totalTokens);

  return response;
});
```

#### 2. Multi-Step Workflow

```typescript
const workflow = trace('ai.workflow', ctx => async (input: string) => {
  // Step 1: Creates child span automatically
  const analysis = await trace('step1.analyze', async () => {
    return await analyzeInput(input);
  });

  // Step 2: Creates another child span
  const response = await trace('step2.generate', async () => {
    return await generateResponse(analysis);
  });

  return response;
});
```

#### 3. Agent Handoffs

```typescript
const runAgentWorkflow = trace('workflow.agents', ctx => async (input: string) => {
  // Set workflow context
  ctx.setAttributes({
    'workflow.type': 'multi_agent',
    'workflow.correlation_id': ctx.correlationId, // Auto-generated!
  });

  // Agent 1
  const triageResult = await triageAgent(input);
  ctx.setAttribute('handoff.from', 'triage');

  // Agent 2
  const specialistResult = await specialistAgent(triageResult);

  return specialistResult;
});
```

#### 4. RAG Pipeline

```typescript
const ragQuery = trace('rag.query', ctx => async (query: string) => {
  // Step 1: Embeddings
  const embedding = await trace('rag.embed', async () => {
    return await generateEmbedding(query);
  });

  // Step 2: Search
  const results = await trace('rag.search', async () => {
    return await vectorDb.search(embedding, 5);
  });

  // Step 3: Generate
  const response = await trace('rag.generate', async () => {
    return await llm.generate({ query, context: results });
  });

  return response;
});
```

#### 5. Correlation IDs (Automatic)

```typescript
const operation = trace('operation', ctx => async () => {
  // Automatically available - no setup required!
  const correlationId = ctx.correlationId;

  // Automatically propagates to:
  // - All nested trace() calls
  // - Events events via track()
  // - Structured logs

  console.log('Correlation:', correlationId);
});
```

### Semantic Conventions

#### Agent Attributes
```typescript
ctx.setAttributes({
  'agent.role': 'specialist',
  'agent.model': 'gpt-4o',
  'agent.provider': 'openai',
  'agent.temperature': 0.7,
});
```

#### LLM Attributes
```typescript
ctx.setAttributes({
  'llm.model': 'gpt-4o',
  'llm.provider': 'openai',
  'llm.prompt_tokens': 100,
  'llm.completion_tokens': 250,
  'llm.total_tokens': 350,
});
```

#### Workflow Attributes
```typescript
ctx.setAttributes({
  'workflow.type': 'multi_agent_escalation',
  'workflow.correlation_id': ctx.correlationId,
  'workflow.user_id': userId,
});
```

#### RAG Attributes
```typescript
ctx.setAttributes({
  'rag.embedding_model': 'text-embedding-3-small',
  'rag.chunks_retrieved': 5,
  'rag.top_score': 0.95,
});
```

#### Business Events
```typescript
// Span attributes
ctx.setAttribute('specialist.engaged', true);

// Events events
import { track } from 'autotel';

track('workflow.completed', {
  type: 'multi_agent',
  agents_used: 3,
  // traceId, spanId, correlationId auto-added!
});
```

### Key Takeaways

1. ✅ **Use nested `trace()` calls** for multi-step workflows (creates parent-child spans)
2. ✅ **Correlation IDs are automatic** via `ctx.correlationId` (no manual setup)
3. ✅ **OpenLLMetry auto-instruments LLM calls** (just enable it in `init()`)
4. ✅ **Business events via `ctx.setAttribute()` and `track()`** (enriched with trace context)
5. ✅ **Works with ANY LLM SDK** (OpenAI, Anthropic, Vercel AI SDK, etc.)
6. ✅ **OTLP-native** (works with any observability backend)

---

## Core Concepts

### Correlation IDs

Correlation IDs automatically propagate through your entire workflow, making it easy to trace requests across multiple agents, services, and LLM calls.

```typescript
import { trace, track } from 'autotel';

export const processUserRequest = trace('ai.user_request', ctx => async (userId: string, message: string) => {
  // Correlation ID is automatically available
  console.log('Trace ID:', ctx.traceId);
  console.log('Correlation ID:', ctx.correlationId); // First 16 chars of traceId

  // All nested operations inherit this correlation context
  const analysis = await analyzeIntent(message);
  const response = await generateResponse(analysis);

  // Events events automatically include correlation IDs
  track('ai.request_completed', {
    userId,
    intent: analysis.intent,
    // correlationId, traceId, spanId are auto-added!
  });

  return response;
});
```

**What you get automatically:**
- ✅ `ctx.traceId` - Full OpenTelemetry trace ID
- ✅ `ctx.correlationId` - Short correlation ID (first 16 chars)
- ✅ `ctx.spanId` - Current span ID
- ✅ Automatic propagation to all nested `trace()` calls
- ✅ Enrichment of all `track()` events events
- ✅ Inclusion in structured logs (via `autotel/logger`)

### Multi-Step Workflows

Create parent-child span hierarchies naturally with nested `trace()` calls. Each step becomes a child span with automatic error handling and lifecycle management.

```typescript
import { trace } from 'autotel';

// Each nested trace() call creates a child span
export const processDocument = trace('document.processing', ctx => async (docId: string) => {
  // Set workflow-level attributes
  ctx.setAttribute('document.id', docId);
  ctx.setAttribute('workflow.type', 'document_processing');

  // Step 1: Load document (creates child span)
  const document = await trace('document.load', async () => {
    return await loadDocument(docId);
  });

  // Step 2: Analyze with LLM (creates child span, OpenLLMetry auto-instruments LLM call)
  const analysis = await trace('document.analyze', async () => {
    const result = await llm.analyze(document.content);
    return result;
  });

  // Step 3: Store results (creates child span)
  const stored = await trace('document.store', async () => {
    return await storeAnalysis(docId, analysis);
  });

  return stored;
});
```

**Span Hierarchy Created:**
```
document.processing (parent)
├── document.load (child)
├── document.analyze (child)
│   └── openai.chat.completions (child, auto-instrumented by OpenLLMetry)
└── document.store (child)
```

### Domain Events

Track business-level events alongside technical telemetry using `ctx.setAttribute()` for span attributes and `track()` for events events.

```typescript
import { trace, track } from 'autotel';

export const handleAgentHandoff = trace('agent.handoff', ctx => async (task: Task) => {
  const startTime = performance.now();

  // Set domain-specific span attributes
  ctx.setAttributes({
    'agent.from': 'triage',
    'agent.to': 'specialist',
    'task.priority': task.priority,
    'task.category': task.category,
  });

  // Perform handoff
  const result = await specialistAgent.process(task);

  // Track business metric with precise duration
  track('agent.handoff_completed', {
    from: 'triage',
    to: 'specialist',
    duration_ms: Math.round(performance.now() - startTime),
    success: true,
  });

  return result;
});
```

## Pattern: Multi-Agent Workflows

Multi-agent systems require tracking "baton passes" between agents with full context propagation.

### Example: Triage → Specialist → QA Escalation

```typescript
import { trace, track } from 'autotel';
import { generateText, generateObject } from 'ai'; // Vercel AI SDK example

// Agent 1: Triage
const triageAgent = trace('agent.triage', ctx => async (userRequest: string) => {
  ctx.setAttributes({
    'agent.role': 'triage',
    'agent.model': 'gpt-4o-mini',
  });

  const result = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `Analyze this request and create a plan: ${userRequest}`,
  });

  track('agent.triage_completed', {
    request_length: userRequest.length,
    plan_length: result.text.length,
  });

  return {
    plan: result.text,
    requiresSpecialist: true,
  };
});

// Agent 2: Specialist
const specialistAgent = trace('agent.specialist', ctx => async (plan: string) => {
  ctx.setAttributes({
    'agent.role': 'specialist',
    'agent.model': 'gpt-4o',
  });

  ctx.addEvent('specialist_engaged', { plan_length: plan.length });

  const result = await generateText({
    model: openai('gpt-4o'),
    prompt: `Execute this plan: ${plan}`,
  });

  track('agent.specialist_completed', {
    plan_length: plan.length,
    response_length: result.text.length,
  });

  return {
    response: result.text,
    requiresQA: true,
  };
});

// Agent 3: QA
const qaAgent = trace('agent.qa', ctx => async (response: string) => {
  ctx.setAttributes({
    'agent.role': 'qa',
    'agent.model': 'gpt-4o',
  });

  const result = await generateObject({
    model: openai('gpt-4o'),
    schema: z.object({
      approved: z.boolean(),
      feedback: z.string().optional(),
      requiresFollowUp: z.boolean(),
    }),
    prompt: `Review this response for quality: ${response}`,
  });

  ctx.setAttribute('qa.approved', result.object.approved);

  track('agent.qa_completed', {
    approved: result.object.approved,
    requires_follow_up: result.object.requiresFollowUp,
  });

  return result.object;
});

// Orchestrator: Workflow coordinator
export const runMultiAgentWorkflow = trace('workflow.multi_agent_escalation', ctx => async (userRequest: string, userId: string) => {
  ctx.setAttributes({
    'workflow.type': 'multi_agent_escalation',
    'workflow.user_id': userId,
    'workflow.correlation_id': ctx.correlationId,
  });

  // Step 1: Triage
  const triage = await triageAgent(userRequest);
  ctx.addEvent('triage_complete', { requires_specialist: triage.requiresSpecialist });

  // Step 2: Specialist (if needed)
  let response;
  if (triage.requiresSpecialist) {
    response = await specialistAgent(triage.plan);
    ctx.addEvent('specialist_complete', { requires_qa: response.requiresQA });
  }

  // Step 3: QA (if needed)
  let qa;
  if (response?.requiresQA) {
    qa = await qaAgent(response.response);
    ctx.addEvent('qa_complete', { approved: qa.approved });
  }

  // Track workflow completion
  track('workflow.completed', {
    workflow_type: 'multi_agent_escalation',
    user_id: userId,
    agents_involved: qa ? 3 : response ? 2 : 1,
    final_approval: qa?.approved ?? true,
  });

  return {
    plan: triage.plan,
    response: response?.response,
    qa: qa,
  };
});
```

**Observability Benefits:**
- ✅ Full trace tree showing agent handoffs
- ✅ Correlation ID tracks request across all agents
- ✅ Each agent's LLM calls auto-instrumented by OpenLLMetry
- ✅ Business events (handoffs, approvals) tracked in events
- ✅ Agent roles and models tagged for filtering

## Pattern: RAG Pipelines

Retrieval-Augmented Generation (RAG) pipelines involve embeddings, vector search, retrieval, and generation steps.

```typescript
import { trace } from 'autotel';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';

// Step 1: Generate embeddings
const generateEmbeddings = trace('rag.embeddings', ctx => async (query: string) => {
  ctx.setAttribute('query.length', query.length);

  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  });

  ctx.setAttribute('embedding.dimensions', embedding.length);

  return embedding;
});

// Step 2: Vector search
const vectorSearch = trace('rag.search', ctx => async (embedding: number[], topK: number = 5) => {
  ctx.setAttributes({
    'search.top_k': topK,
    'search.embedding_dimensions': embedding.length,
  });

  // OpenLLMetry auto-instruments vector DB operations
  const results = await vectorDb.search(embedding, topK);

  ctx.setAttribute('search.results_count', results.length);

  return results;
});

// Step 3: Generate response with context
const generateWithContext = trace('rag.generate', ctx => async (query: string, context: string[]) => {
  ctx.setAttributes({
    'generation.context_chunks': context.length,
    'generation.model': 'gpt-4o',
  });

  const prompt = `
Context:
${context.join('\n\n')}

Question: ${query}

Answer based on the context above:
  `.trim();

  const result = await generateText({
    model: openai('gpt-4o'),
    prompt,
  });

  ctx.setAttributes({
    'generation.tokens_used': result.usage.totalTokens,
    'generation.response_length': result.text.length,
  });

  return result.text;
});

// Complete RAG Pipeline
export const ragPipeline = trace('rag.pipeline', ctx => async (query: string, userId: string) => {
  ctx.setAttributes({
    'pipeline.type': 'rag',
    'pipeline.user_id': userId,
    'pipeline.query': query,
  });

  // Step 1: Embeddings
  const embedding = await generateEmbeddings(query);
  ctx.addEvent('embeddings_generated');

  // Step 2: Search
  const searchResults = await vectorSearch(embedding);
  ctx.addEvent('search_completed', { results_count: searchResults.length });

  // Step 3: Generate
  const context = searchResults.map(r => r.content);
  const response = await generateWithContext(query, context);
  ctx.addEvent('generation_completed', { response_length: response.length });

  // Track pipeline completion
  track('rag.pipeline_completed', {
    user_id: userId,
    query_length: query.length,
    results_retrieved: searchResults.length,
    response_length: response.length,
  });

  return {
    query,
    response,
    sources: searchResults.map(r => r.metadata),
  };
});
```

**Span Hierarchy:**
```
rag.pipeline (parent)
├── rag.embeddings (child)
│   └── openai.embeddings (auto-instrumented by OpenLLMetry)
├── rag.search (child)
│   └── pinecone.query (auto-instrumented by OpenLLMetry)
└── rag.generate (child)
    └── openai.chat.completions (auto-instrumented by OpenLLMetry)
```

## Pattern: Streaming Responses

Track streaming LLM responses with progress events and final metrics.

```typescript
import { trace } from 'autotel';
import { streamText } from 'ai';

export const generateStreamingResponse = trace('ai.stream', ctx => async (prompt: string) => {
  ctx.setAttributes({
    'stream.model': 'gpt-4o',
    'stream.prompt_length': prompt.length,
  });

  const stream = await streamText({
    model: openai('gpt-4o'),
    prompt,
  });

  let chunkCount = 0;
  let totalLength = 0;

  // Track streaming progress
  const chunks: string[] = [];
  for await (const chunk of stream.textStream) {
    chunkCount++;
    totalLength += chunk.length;
    chunks.push(chunk);

    // Add event for significant milestones
    if (chunkCount % 10 === 0) {
      ctx.addEvent('streaming_progress', {
        chunks_received: chunkCount,
        total_length: totalLength,
      });
    }
  }

  // Set final metrics
  ctx.setAttributes({
    'stream.chunks_count': chunkCount,
    'stream.total_length': totalLength,
    'stream.avg_chunk_size': Math.round(totalLength / chunkCount),
  });

  track('ai.stream_completed', {
    model: 'gpt-4o',
    chunks: chunkCount,
    total_length: totalLength,
  });

  return chunks.join('');
});
```

## Pattern: Evaluation Loops

Implement quality checks and iterative refinement with full observability.

```typescript
import { trace } from 'autotel';

const generateContent = trace('ai.generate_content', ctx => async (prompt: string, model: string) => {
  ctx.setAttribute('generation.model', model);

  const result = await generateText({
    model: openai(model),
    prompt,
  });

  return result.text;
});

const evaluateQuality = trace('ai.evaluate_quality', ctx => async (content: string) => {
  const result = await generateObject({
    model: openai('gpt-4o'),
    schema: z.object({
      score: z.number().min(0).max(100),
      feedback: z.string(),
      passesThreshold: z.boolean(),
    }),
    prompt: `Evaluate this content quality (0-100): ${content}`,
  });

  ctx.setAttributes({
    'evaluation.score': result.object.score,
    'evaluation.passes': result.object.passesThreshold,
  });

  return result.object;
});

export const generateWithQualityCheck = trace('ai.generate_with_qa', ctx => async (
  prompt: string,
  options: { maxAttempts?: number; qualityThreshold?: number } = {}
) => {
  const { maxAttempts = 3, qualityThreshold = 75 } = options;

  ctx.setAttributes({
    'qa.max_attempts': maxAttempts,
    'qa.threshold': qualityThreshold,
  });

  let attempt = 0;
  let content: string;
  let evaluation: any;

  // Evaluation loop
  do {
    attempt++;
    ctx.addEvent('generation_attempt', { attempt });

    // Generate content
    content = await generateContent(prompt, 'gpt-4o');

    // Evaluate quality
    evaluation = await evaluateQuality(content);

    if (evaluation.passesThreshold) {
      ctx.addEvent('quality_passed', {
        attempt,
        score: evaluation.score
      });
      break;
    } else if (attempt < maxAttempts) {
      ctx.addEvent('quality_failed_retrying', {
        attempt,
        score: evaluation.score,
        feedback: evaluation.feedback,
      });
      // Refine prompt with feedback
      prompt = `${prompt}\n\nPrevious attempt feedback: ${evaluation.feedback}`;
    }
  } while (attempt < maxAttempts);

  ctx.setAttributes({
    'qa.attempts_used': attempt,
    'qa.final_score': evaluation.score,
    'qa.success': evaluation.passesThreshold,
  });

  track('ai.qa_loop_completed', {
    attempts: attempt,
    final_score: evaluation.score,
    success: evaluation.passesThreshold,
    threshold: qualityThreshold,
  });

  return {
    content,
    evaluation,
    attempts: attempt,
  };
});
```

## AI Semantic Conventions

Following OpenTelemetry semantic conventions ensures consistency across your AI applications.

### Recommended Attribute Names

```typescript
// Agent-related attributes
ctx.setAttributes({
  'agent.role': 'triage' | 'specialist' | 'qa',
  'agent.model': 'gpt-4o',
  'agent.provider': 'openai',
  'agent.temperature': 0.7,
});

// Workflow attributes
ctx.setAttributes({
  'workflow.type': 'multi_agent_escalation',
  'workflow.correlation_id': ctx.correlationId,
  'workflow.user_id': userId,
  'workflow.session_id': sessionId,
});

// LLM operation attributes (when not using OpenLLMetry)
ctx.setAttributes({
  'llm.model': 'gpt-4o',
  'llm.provider': 'openai',
  'llm.temperature': 0.7,
  'llm.max_tokens': 4096,
  'llm.response_tokens': 250,
  'llm.prompt_tokens': 100,
  'llm.total_tokens': 350,
});

// RAG-specific attributes
ctx.setAttributes({
  'rag.embedding_model': 'text-embedding-3-small',
  'rag.chunks_retrieved': 5,
  'rag.search_top_k': 5,
  'rag.rerank_enabled': true,
});

// Evaluation attributes
ctx.setAttributes({
  'evaluation.score': 85,
  'evaluation.threshold': 75,
  'evaluation.passes': true,
  'evaluation.attempts': 2,
});
```

### Event Names

```typescript
// Agent events
ctx.addEvent('agent.handoff_initiated');
ctx.addEvent('agent.handoff_completed');
ctx.addEvent('agent.escalation_required');

// RAG events
ctx.addEvent('rag.embeddings_generated');
ctx.addEvent('rag.search_completed');
ctx.addEvent('rag.context_assembled');

// Quality events
ctx.addEvent('quality.check_initiated');
ctx.addEvent('quality.check_passed');
ctx.addEvent('quality.check_failed');
ctx.addEvent('quality.retry_initiated');
```

## Complete Examples

### Example: Customer Support Multi-Agent System

```typescript
import { trace, track, init } from 'autotel';
import { generateText, generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

// Initialize with OpenLLMetry
init({
  service: 'customer-support-ai',
  endpoint: process.env.OTLP_ENDPOINT,
  openllmetry: {
    enabled: true,
    options: {
      disableBatch: process.env.NODE_ENV !== 'production',
    },
  },
});

// Routing Agent
const routeRequest = trace('support.route', ctx => async (message: string, userId: string) => {
  ctx.setAttributes({
    'agent.role': 'router',
    'support.user_id': userId,
  });

  const result = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: z.object({
      category: z.enum(['billing', 'technical', 'account', 'general']),
      priority: z.enum(['low', 'medium', 'high', 'urgent']),
      requiresHuman: z.boolean(),
    }),
    prompt: `Categorize this support request: ${message}`,
  });

  ctx.setAttributes({
    'support.category': result.object.category,
    'support.priority': result.object.priority,
    'support.requires_human': result.object.requiresHuman,
  });

  return result.object;
});

// Specialist Agent
const handleSpecialistRequest = trace('support.specialist', ctx => async (
  message: string,
  category: string,
  context: any
) => {
  ctx.setAttributes({
    'agent.role': 'specialist',
    'support.category': category,
  });

  const result = await generateText({
    model: openai('gpt-4o'),
    prompt: `
You are a ${category} support specialist.

Customer message: ${message}

Previous context: ${JSON.stringify(context)}

Provide a helpful response:
    `.trim(),
  });

  ctx.setAttribute('response.length', result.text.length);

  return result.text;
});

// Main workflow
export const handleSupportRequest = trace('support.workflow', ctx => async (
  userId: string,
  message: string,
  sessionContext: any = {}
) => {
  ctx.setAttributes({
    'workflow.type': 'customer_support',
    'workflow.user_id': userId,
    'workflow.session_id': sessionContext.sessionId,
  });

  // Step 1: Route request
  const routing = await routeRequest(message, userId);
  ctx.addEvent('routing_completed', {
    category: routing.category,
    priority: routing.priority,
  });

  // Step 2: Handle with specialist
  let response: string;
  if (routing.requiresHuman) {
    response = 'This request requires human assistance. A support agent will contact you shortly.';
    ctx.addEvent('escalated_to_human');

    track('support.escalated_to_human', {
      user_id: userId,
      category: routing.category,
      priority: routing.priority,
    });
  } else {
    response = await handleSpecialistRequest(message, routing.category, sessionContext);
    ctx.addEvent('specialist_handled');
  }

  // Track completion
  track('support.request_handled', {
    user_id: userId,
    category: routing.category,
    priority: routing.priority,
    escalated: routing.requiresHuman,
    response_length: response.length,
  });

  return {
    response,
    category: routing.category,
    priority: routing.priority,
    requiresHuman: routing.requiresHuman,
  };
});
```

### Example: Content Generation Pipeline with A/B Testing

```typescript
import { trace, track } from 'autotel';

const generateVariant = trace('content.generate_variant', ctx => async (
  prompt: string,
  variantId: string,
  model: string
) => {
  ctx.setAttributes({
    'variant.id': variantId,
    'variant.model': model,
  });

  const result = await generateText({
    model: openai(model),
    prompt,
  });

  ctx.setAttribute('variant.length', result.text.length);

  return result.text;
});

export const generateABTestContent = trace('content.ab_test', ctx => async (
  prompt: string,
  userId: string
) => {
  ctx.setAttributes({
    'experiment.type': 'ab_test',
    'experiment.user_id': userId,
  });

  // Randomly assign variant (or use feature flag service)
  const variant = Math.random() < 0.5 ? 'A' : 'B';
  const model = variant === 'A' ? 'gpt-4o' : 'gpt-4o-mini';

  ctx.setAttribute('experiment.variant', variant);

  // Generate content
  const content = await generateVariant(prompt, variant, model);

  // Track experiment exposure
  track('experiment.exposed', {
    experiment_name: 'content_model_test',
    variant,
    user_id: userId,
  });

  return {
    content,
    variant,
    model,
  };
});
```

## Next Steps

1. **Review OpenLLMetry Integration**: See the main [README.md](../packages/autotel/README.md#llm-observability-with-openllmetry) for setup instructions
2. **Explore Examples**: Check out the working examples in `apps/` directory
3. **Configure Observability Backend**: Connect to Grafana, Datadog, Langfuse, or any OTLP-compatible backend
4. **Add Events**: Configure adapters for PostHog, Mixpanel, or custom webhooks
5. **Monitor Production**: Use adaptive sampling and rate limiting for production deployments

## Summary

**Key Takeaway**: Autotel's existing functional API (`trace()`, `ctx`, `track()`) provides everything needed for comprehensive AI/LLM observability. Combined with OpenLLMetry's automatic instrumentation, you get:

- ✅ Multi-agent workflow orchestration
- ✅ Automatic correlation ID propagation
- ✅ Business event tracking alongside technical metrics
- ✅ Full compatibility with any LLM provider/SDK
- ✅ OTLP-native output to any observability backend
- ✅ Product events integration

No special "AI-specific" APIs required - just familiar, composable patterns that work for any workflow!
