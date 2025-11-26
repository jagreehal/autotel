/**
 * RAG Pipeline Example
 *
 * Demonstrates:
 * - Retrieval-Augmented Generation workflow
 * - Embeddings generation tracking
 * - Vector search observability
 * - Context assembly monitoring
 * - Generation with retrieved context
 *
 * This example uses simulated operations to demonstrate instrumentation patterns.
 * In production:
 * - Replace with actual embedding models (OpenAI, Cohere, etc.)
 * - Use real vector databases (Pinecone, Chroma, Qdrant, etc.)
 * - Enable OpenLLMetry for automatic instrumentation
 */

import { init, trace, track, shutdown, type TraceContext } from 'autotel';
import 'dotenv/config';

// Initialize autotel
init({
  service: 'rag-pipeline-example',
  environment: process.env.NODE_ENV || 'development',
  endpoint: process.env.OTLP_ENDPOINT,
  // Optional: Enable OpenLLMetry for automatic instrumentation
  // openllmetry: {
  //   enabled: true,
  //   options: {
  //     disableBatch: process.env.NODE_ENV !== 'production',
  //   },
  // },
});

// ======================
// Simulated Data
// ======================

interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata: {
    source: string;
    chunk_id: number;
  };
}

// Mock knowledge base
const KNOWLEDGE_BASE: VectorSearchResult[] = [
  {
    id: '1',
    content: 'The company was founded in 2020 and focuses on cloud infrastructure.',
    score: 0.95,
    metadata: { source: 'about.md', chunk_id: 1 },
  },
  {
    id: '2',
    content: 'Our product offers automatic scaling, monitoring, and deployment tools.',
    score: 0.89,
    metadata: { source: 'features.md', chunk_id: 2 },
  },
  {
    id: '3',
    content: 'We serve over 10,000 customers across 50 countries.',
    score: 0.82,
    metadata: { source: 'stats.md', chunk_id: 1 },
  },
  {
    id: '4',
    content: 'Pricing starts at $29/month for the basic plan.',
    score: 0.78,
    metadata: { source: 'pricing.md', chunk_id: 1 },
  },
  {
    id: '5',
    content: 'Our support team is available 24/7 via chat and email.',
    score: 0.71,
    metadata: { source: 'support.md', chunk_id: 1 },
  },
];

// ======================
// RAG Components
// ======================

/**
 * Step 1: Generate embeddings for query
 * In production: Use OpenAI embeddings, Cohere, etc.
 */
const generateEmbeddings = trace<[string], Promise<number[]>>(
  'rag.embeddings',
  (ctx: TraceContext) => async (query: string): Promise<number[]> => {
  ctx.setAttributes({
    'rag.query': query,
    'rag.query_length': query.length,
    'rag.embedding_model': 'text-embedding-3-small',
    'rag.embedding_provider': 'openai',
  });

  // Simulate embedding generation
  await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));

  // Simulate 1536-dimensional embedding
  const embedding = Array.from({ length: 1536 }, () => Math.random());

  ctx.setAttributes({
    'rag.embedding_dimensions': embedding.length,
    'rag.embeddings_generated': 1,
    'rag.embeddings_complete': true,
  });

  return embedding;
  },
);

/**
 * Step 2: Search vector database
 * In production: Use Pinecone, Chroma, Qdrant, etc.
 */
const vectorSearch = trace<[number[], number], Promise<VectorSearchResult[]>>(
  'rag.search',
  (ctx: TraceContext) => async (
    embedding: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> => {
  ctx.setAttributes({
    'rag.search_top_k': topK,
    'rag.search_embedding_dimensions': embedding.length,
    'rag.vector_db': 'pinecone', // or your vector DB
  });

  // Simulate vector search delay
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));

  // Return top K results from mock data
  const results = KNOWLEDGE_BASE.slice(0, topK);

  ctx.setAttributes({
    'rag.search_results_count': results.length,
    'rag.search_top_score': results[0]?.score ?? 0,
    'rag.search_avg_score': results.reduce((sum, r) => sum + r.score, 0) / results.length,
    'rag.search_complete': true,
  });

  return results;
  },
);

/**
 * Step 3: Assemble context from search results
 */
type AssembledContext = {
  context: string;
  sources: string[];
  metadata: { source: string; chunk_id: number }[];
};

const assembleContext = trace<[VectorSearchResult[]], Promise<AssembledContext>>(
  'rag.context_assembly',
  (ctx: TraceContext) => async (
    results: VectorSearchResult[],
  ): Promise<AssembledContext> => {
  ctx.setAttribute('rag.chunks_to_assemble', results.length);

  // Simulate context assembly processing
  await new Promise(resolve => setTimeout(resolve, 20));

  const context = results
    .map((result, idx) => `[${idx + 1}] ${result.content}`)
    .join('\n\n');

  const totalLength = context.length;
  const sources = results.map(r => r.metadata.source);
  const uniqueSources = [...new Set(sources)];

  ctx.setAttributes({
    'rag.context_length': totalLength,
    'rag.context_chunks': results.length,
    'rag.context_sources': uniqueSources.length,
    'rag.context_complete': true,
  });

  return {
    context,
    sources: uniqueSources,
    metadata: results.map(r => r.metadata),
  };
  },
);

/**
 * Step 4: Generate response with retrieved context
 * In production: Use OpenAI, Anthropic, etc. with OpenLLMetry instrumentation
 */
type GenerationResult = {
  response: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

const generateWithContext = trace<[string, string], Promise<GenerationResult>>(
  'rag.generate',
  (ctx: TraceContext) => async (
    query: string,
    context: string,
  ): Promise<GenerationResult> => {
  ctx.setAttributes({
    'rag.generation_model': 'gpt-4o',
    'rag.generation_provider': 'openai',
    'rag.query_length': query.length,
    'rag.context_length': context.length,
  });

  // Simulate LLM generation
  await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

  // Simulate response
  const response = `Based on the provided context, ${query.toLowerCase()} - Our analysis shows that the information indicates strong performance metrics.`;

  // Simulate token usage
  const promptTokens = Math.ceil((query.length + context.length) / 4);
  const completionTokens = Math.ceil(response.length / 4);
  const totalTokens = promptTokens + completionTokens;

  ctx.setAttributes({
    'rag.generation_response_length': response.length,
    'rag.generation_prompt_tokens': promptTokens,
    'rag.generation_completion_tokens': completionTokens,
    'rag.generation_total_tokens': totalTokens,
    'rag.generation_complete': true,
  });

  return {
    response,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
    },
  };
  },
);

// ======================
// Complete RAG Pipeline
// ======================

/**
 * Orchestrates the full RAG pipeline
 * - Query → Embeddings → Search → Context → Generation
 */
type RagPipelineOptions = { topK?: number };
type RagPipelineResult = {
  query: string;
  response: string;
  sources: string[];
  metadata: AssembledContext['metadata'];
  metrics: {
    duration: number;
    chunksRetrieved: number;
    sourcesUsed: number;
    tokensUsed: number;
    topScore: number;
  };
};

const runRAGPipeline = trace<
  [string, string, RagPipelineOptions | undefined],
  Promise<RagPipelineResult>
>('rag.pipeline', (ctx: TraceContext) => async (
  query: string,
  userId: string,
  options: RagPipelineOptions | undefined,
) => {
  const { topK = 5 } = options ?? {};
  const startTime = performance.now();

  ctx.setAttributes({
    'rag.pipeline_type': 'retrieval_augmented_generation',
    'rag.user_id': userId,
    'rag.query': query,
    'rag.correlation_id': ctx.correlationId,
    'rag.top_k': topK,
  });

  console.log(`\n🔍 Starting RAG Pipeline`);
  console.log(`   Query: "${query}"`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Correlation ID: ${ctx.correlationId}\n`);

  // Step 1: Generate embeddings
  console.log('🧮 Step 1: Generating embeddings...');
  const embedding = await generateEmbeddings(query);
  console.log(`   ✓ Generated ${embedding.length}-dimensional embedding`);

  // Step 2: Vector search
  console.log('\n🔎 Step 2: Searching vector database...');
  const searchResults = await vectorSearch(embedding, topK);
  console.log(`   ✓ Found ${searchResults.length} relevant chunks`);
  console.log(`   ✓ Top score: ${searchResults[0]?.score.toFixed(3)}`);

  // Step 3: Assemble context
  console.log('\n📚 Step 3: Assembling context...');
  const assembled = await assembleContext(searchResults);
  console.log(`   ✓ Context length: ${assembled.context.length} chars`);
  console.log(`   ✓ Sources: ${assembled.sources.join(', ')}`);

  // Step 4: Generate response
  console.log('\n✨ Step 4: Generating response...');
  const generation = await generateWithContext(query, assembled.context);
  console.log(`   ✓ Response: "${generation.response.substring(0, 80)}..."`);
  console.log(`   ✓ Tokens used: ${generation.usage.totalTokens}`);

  // Calculate pipeline metrics
  const duration = Math.round(performance.now() - startTime);

  ctx.setAttributes({
    'rag.pipeline_duration_ms': duration,
    'rag.pipeline_chunks_retrieved': searchResults.length,
    'rag.pipeline_sources_used': assembled.sources.length,
    'rag.pipeline_total_tokens': generation.usage.totalTokens,
  });

  // Track completion
  track('rag.pipeline_completed', {
    user_id: userId,
    query_length: query.length,
    chunks_retrieved: searchResults.length,
    sources_used: assembled.sources.length,
    tokens_used: generation.usage.totalTokens,
    duration_ms: duration,
  });

  console.log(`\n📊 Pipeline Complete:`);
  console.log(`   Duration: ${duration}ms`);
  console.log(`   Chunks retrieved: ${searchResults.length}`);
  console.log(`   Sources: ${assembled.sources.length}`);
  console.log(`   Tokens: ${generation.usage.totalTokens}`);
  console.log(`   Correlation ID: ${ctx.correlationId}\n`);

  return {
    query,
    response: generation.response,
    sources: assembled.sources,
    metadata: assembled.metadata,
    metrics: {
      duration,
      chunksRetrieved: searchResults.length,
      sourcesUsed: assembled.sources.length,
      tokensUsed: generation.usage.totalTokens,
      topScore: searchResults[0]?.score ?? 0,
    },
  };
});

// ======================
// Run Examples
// ======================

async function main() {
  console.log('='.repeat(70));
  console.log('RAG Pipeline Example');
  console.log('='.repeat(70));

  // Example 1: Company information query
  await runRAGPipeline(
    'What does the company do and when was it founded?',
    'user-123',
    { topK: 3 }
  );

  // Example 2: Product features query
  await runRAGPipeline(
    'What are the main features of the product?',
    'user-456',
    { topK: 5 }
  );

  // Graceful shutdown
  console.log('\n📤 Flushing telemetry...');
  await shutdown();
  console.log('✓ Complete!\n');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
