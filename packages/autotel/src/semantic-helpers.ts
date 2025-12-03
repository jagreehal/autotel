/**
 * Semantic convention helpers for OpenTelemetry
 *
 * Pre-configured trace helpers that follow OpenTelemetry semantic conventions
 * for common operation types. Reduces boilerplate and ensures consistency.
 *
 * Based on: https://opentelemetry.io/docs/specs/semconv/
 */

import { trace } from './functional';
import type { TraceContext } from './trace-context';
import type { Attributes } from '@opentelemetry/api';

/**
 * Configuration for LLM (Large Language Model) operations
 *
 * Follows Gen AI semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export interface LLMConfig {
  /** Model name (e.g., 'gpt-4', 'claude-3-opus') */
  model: string;
  /** Operation type */
  operation?: 'chat' | 'completion' | 'embedding';
  /** Model provider (e.g., 'openai', 'anthropic', 'cohere') - maps to gen.ai.system */
  provider?: string;
  /** Additional attributes to add to the span */
  attributes?: Attributes;
}

/**
 * Configuration for database operations
 *
 * Follows DB semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/database/
 */
export interface DBConfig {
  /** Database system (e.g., 'postgresql', 'mongodb', 'redis') */
  system: string;
  /** Operation type (e.g., 'SELECT', 'INSERT', 'find', 'get') */
  operation?: string;
  /** Database name */
  database?: string;
  /** Collection/table name */
  collection?: string;
  /** Additional attributes to add to the span */
  attributes?: Attributes;
}

/**
 * Configuration for HTTP client operations
 *
 * Follows HTTP semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/http/
 */
export interface HTTPConfig {
  /** HTTP method (e.g., 'GET', 'POST') */
  method?: string;
  /** Target URL or URL template */
  url?: string;
  /** Additional attributes to add to the span */
  attributes?: Attributes;
}

/**
 * Configuration for messaging operations
 *
 * Follows Messaging semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/messaging/
 */
export interface MessagingConfig {
  /** Messaging system (e.g., 'kafka', 'rabbitmq', 'sqs') */
  system: string;
  /** Operation type */
  operation?: 'publish' | 'receive' | 'process';
  /** Destination name (queue/topic) */
  destination?: string;
  /** Additional attributes to add to the span */
  attributes?: Attributes;
}

/**
 * Trace LLM operations with Gen AI semantic conventions
 *
 * Automatically adds standard attributes for LLM operations:
 * - gen.ai.request.model
 * - gen.ai.operation.name
 * - gen.ai.system
 *
 * **Use Cases:**
 * - Chat completions
 * - Text generation
 * - Embeddings
 * - Multi-step LLM workflows
 *
 * @param config - LLM operation configuration
 * @returns Traced function factory with Gen AI attributes
 *
 * @example Chat completion with OpenAI
 * ```typescript
 * import { traceLLM } from 'autotel/semantic-helpers'
 * import OpenAI from 'openai'
 *
 * const openai = new OpenAI()
 *
 * export const generateResponse = traceLLM({
 *   model: 'gpt-4-turbo',
 *   operation: 'chat',
 *   provider: 'openai'
 * })(ctx => async (prompt: string) => {
 *   const response = await openai.chat.completions.create({
 *     model: 'gpt-4-turbo',
 *     messages: [{ role: 'user', content: prompt }]
 *   })
 *
 *   // Add usage metrics to span
 *   ctx.setAttribute('gen.ai.usage.completion_tokens', response.usage?.completion_tokens)
 *   ctx.setAttribute('gen.ai.usage.prompt_tokens', response.usage?.prompt_tokens)
 *
 *   return response.choices[0].message.content
 * })
 * ```
 *
 * @example Anthropic Claude with streaming
 * ```typescript
 * import { traceLLM } from 'autotel/semantic-helpers'
 * import Anthropic from '@anthropic-ai/sdk'
 *
 * const anthropic = new Anthropic()
 *
 * export const streamResponse = traceLLM({
 *   model: 'claude-3-opus-20240229',
 *   operation: 'chat',
 *   provider: 'anthropic'
 * })(ctx => async function* (prompt: string) {
 *   const stream = await anthropic.messages.create({
 *     model: 'claude-3-opus-20240229',
 *     messages: [{ role: 'user', content: prompt }],
 *     stream: true,
 *     max_tokens: 1024
 *   })
 *
 *   let totalTokens = 0
 *   for await (const event of stream) {
 *     if (event.type === 'content_block_delta') {
 *       yield event.delta.text
 *     }
 *     if (event.type === 'message_stop') {
 *       ctx.setAttribute('gen.ai.usage.completion_tokens', event.message.usage.output_tokens)
 *       totalTokens = event.message.usage.output_tokens
 *     }
 *   }
 *
 *   return totalTokens
 * })
 * ```
 *
 * @example Embeddings
 * ```typescript
 * import { traceLLM } from 'autotel/semantic-helpers'
 * import { OpenAIEmbeddings } from '@langchain/openai'
 *
 * const embeddings = new OpenAIEmbeddings()
 *
 * export const embed = traceLLM({
 *   model: 'text-embedding-3-small',
 *   operation: 'embedding',
 *   provider: 'openai'
 * })(ctx => async (text: string) => {
 *   const result = await embeddings.embedQuery(text)
 *   ctx.setAttribute('gen.ai.response.embedding_length', result.length)
 *   return result
 * })
 * ```
 *
 * @public
 */
export function traceLLM<TArgs extends unknown[], TReturn>(config: LLMConfig) {
  return (
    fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>((ctx) => {
      // Set semantic convention attributes
      ctx.setAttribute('gen.ai.request.model', config.model);
      ctx.setAttribute('gen.ai.operation.name', config.operation || 'chat');
      if (config.provider) {
        ctx.setAttribute('gen.ai.system', config.provider);
      }
      if (config.attributes) {
        for (const [key, value] of Object.entries(config.attributes)) {
          if (value !== undefined && value !== null) {
            // setAttribute only accepts primitives (string | number | boolean)
            // Arrays and objects should be serialized
            const attrValue =
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean'
                ? value
                : JSON.stringify(value);
            ctx.setAttribute(key, attrValue);
          }
        }
      }

      // Call the user's factory to get their function and return it
      return fnFactory(ctx);
    });
  };
}

/**
 * Trace database operations with DB semantic conventions
 *
 * Automatically adds standard attributes for database operations:
 * - db.system
 * - db.operation
 * - db.name
 * - db.collection.name (for NoSQL)
 *
 * **Use Cases:**
 * - SQL queries (PostgreSQL, MySQL, SQLite)
 * - NoSQL operations (MongoDB, DynamoDB, Redis)
 * - ORM queries (Prisma, TypeORM, Drizzle)
 *
 * @param config - Database operation configuration
 * @returns Traced function factory with DB attributes
 *
 * @example PostgreSQL query
 * ```typescript
 * import { traceDB } from 'autotel/semantic-helpers'
 * import { pool } from './db'
 *
 * export const getUser = traceDB({
 *   system: 'postgresql',
 *   operation: 'SELECT',
 *   database: 'app_db',
 *   collection: 'users'
 * })(ctx => async (userId: string) => {
 *   const query = 'SELECT * FROM users WHERE id = $1'
 *   ctx.setAttribute('db.statement', query)
 *
 *   const result = await pool.query(query, [userId])
 *   ctx.setAttribute('db.rows_affected', result.rowCount)
 *
 *   return result.rows[0]
 * })
 * ```
 *
 * @example MongoDB with Mongoose
 * ```typescript
 * import { traceDB } from 'autotel/semantic-helpers'
 * import { User } from './models/User'
 *
 * export const findUsers = traceDB({
 *   system: 'mongodb',
 *   operation: 'find',
 *   database: 'app_db',
 *   collection: 'users'
 * })(ctx => async (filter: object) => {
 *   ctx.setAttribute('db.mongodb.filter', JSON.stringify(filter))
 *
 *   const users = await User.find(filter).limit(100)
 *   ctx.setAttribute('db.response.count', users.length)
 *
 *   return users
 * })
 * ```
 *
 * @example Redis operations
 * ```typescript
 * import { traceDB } from 'autotel/semantic-helpers'
 * import { redis } from './redis'
 *
 * export const cacheGet = traceDB({
 *   system: 'redis',
 *   operation: 'GET'
 * })(ctx => async (key: string) => {
 *   ctx.setAttribute('db.redis.key', key)
 *
 *   const value = await redis.get(key)
 *   ctx.setAttribute('db.response.cache_hit', value !== null)
 *
 *   return value
 * })
 * ```
 *
 * @example Prisma with detailed query info
 * ```typescript
 * import { traceDB } from 'autotel/semantic-helpers'
 * import { prisma } from './prisma'
 *
 * export const createPost = traceDB({
 *   system: 'postgresql',
 *   operation: 'INSERT',
 *   database: 'app_db',
 *   collection: 'posts'
 * })(ctx => async (data: { title: string; content: string; authorId: string }) => {
 *   ctx.setAttribute('db.prisma.model', 'Post')
 *   ctx.setAttribute('db.prisma.action', 'create')
 *
 *   const post = await prisma.post.create({ data })
 *
 *   ctx.setAttribute('db.response.id', post.id)
 *   return post
 * })
 * ```
 *
 * @public
 */
export function traceDB<TArgs extends unknown[], TReturn>(config: DBConfig) {
  return (
    fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>((ctx) => {
      // Set semantic convention attributes
      ctx.setAttribute('db.system', config.system);
      if (config.operation) {
        ctx.setAttribute('db.operation', config.operation);
      }
      if (config.database) {
        ctx.setAttribute('db.name', config.database);
      }
      if (config.collection) {
        ctx.setAttribute('db.collection.name', config.collection);
      }
      if (config.attributes) {
        for (const [key, value] of Object.entries(config.attributes)) {
          if (value !== undefined && value !== null) {
            // setAttribute only accepts primitives (string | number | boolean)
            // Arrays and objects should be serialized
            const attrValue =
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean'
                ? value
                : JSON.stringify(value);
            ctx.setAttribute(key, attrValue);
          }
        }
      }

      // Call the user's factory to get their function and return it
      return fnFactory(ctx);
    });
  };
}

/**
 * Trace HTTP client operations with HTTP semantic conventions
 *
 * Automatically adds standard attributes for HTTP requests:
 * - http.request.method
 * - url.full
 *
 * **Use Cases:**
 * - External API calls
 * - Microservice communication
 * - Third-party integrations
 *
 * @param config - HTTP operation configuration
 * @returns Traced function factory with HTTP attributes
 *
 * @example Fetch API
 * ```typescript
 * import { traceHTTP } from 'autotel/semantic-helpers'
 *
 * export const fetchUser = traceHTTP({
 *   method: 'GET',
 *   url: 'https://api.example.com/users/:id'
 * })(ctx => async (userId: string) => {
 *   const url = `https://api.example.com/users/${userId}`
 *   ctx.setAttribute('url.full', url)
 *
 *   const response = await fetch(url)
 *   ctx.setAttribute('http.response.status_code', response.status)
 *
 *   if (!response.ok) {
 *     ctx.setAttribute('error', true)
 *     throw new Error(`HTTP ${response.status}: ${response.statusText}`)
 *   }
 *
 *   return response.json()
 * })
 * ```
 *
 * @example Axios with retry logic
 * ```typescript
 * import { traceHTTP } from 'autotel/semantic-helpers'
 * import axios from 'axios'
 *
 * export const sendWebhook = traceHTTP({
 *   method: 'POST',
 *   url: 'https://webhook.example.com/events'
 * })(ctx => async (payload: object) => {
 *   let attempts = 0
 *   const maxAttempts = 3
 *
 *   while (attempts < maxAttempts) {
 *     try {
 *       attempts++
 *       ctx.setAttribute('http.request.resend_count', attempts - 1)
 *
 *       const response = await axios.post('https://webhook.example.com/events', payload)
 *       ctx.setAttribute('http.response.status_code', response.status)
 *       return response.data
 *     } catch (error) {
 *       if (attempts >= maxAttempts) throw error
 *       await new Promise(resolve => setTimeout(resolve, 1000 * attempts))
 *     }
 *   }
 * })
 * ```
 *
 * @public
 */
export function traceHTTP<TArgs extends unknown[], TReturn>(
  config: HTTPConfig,
) {
  return (
    fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>((ctx) => {
      // Set semantic convention attributes
      if (config.method) {
        ctx.setAttribute('http.request.method', config.method);
      }
      if (config.url) {
        ctx.setAttribute('url.full', config.url);
      }
      if (config.attributes) {
        for (const [key, value] of Object.entries(config.attributes)) {
          if (value !== undefined && value !== null) {
            // setAttribute only accepts primitives (string | number | boolean)
            // Arrays and objects should be serialized
            const attrValue =
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean'
                ? value
                : JSON.stringify(value);
            ctx.setAttribute(key, attrValue);
          }
        }
      }

      // Call the user's factory to get their function and return it
      return fnFactory(ctx);
    });
  };
}

/**
 * Trace messaging operations with Messaging semantic conventions
 *
 * Automatically adds standard attributes for messaging:
 * - messaging.system
 * - messaging.operation
 * - messaging.destination.name
 *
 * **Use Cases:**
 * - Publishing messages to queues/topics
 * - Consuming messages from queues/topics
 * - Event-driven architectures
 *
 * @param config - Messaging operation configuration
 * @returns Traced function factory with Messaging attributes
 *
 * @example Publishing to Kafka
 * ```typescript
 * import { traceMessaging } from 'autotel/semantic-helpers'
 * import { kafka } from './kafka'
 *
 * const producer = kafka.producer()
 *
 * export const publishEvent = traceMessaging({
 *   system: 'kafka',
 *   operation: 'publish',
 *   destination: 'user-events'
 * })(ctx => async (event: { type: string; userId: string; data: object }) => {
 *   ctx.setAttribute('messaging.message.type', event.type)
 *   ctx.setAttribute('messaging.kafka.partition', 0)
 *
 *   await producer.send({
 *     topic: 'user-events',
 *     messages: [
 *       {
 *         key: event.userId,
 *         value: JSON.stringify(event.data)
 *       }
 *     ]
 *   })
 *
 *   ctx.setAttribute('messaging.message.id', event.userId)
 * })
 * ```
 *
 * @example Consuming from RabbitMQ
 * ```typescript
 * import { traceMessaging } from 'autotel/semantic-helpers'
 * import { channel } from './rabbitmq'
 *
 * export const processOrder = traceMessaging({
 *   system: 'rabbitmq',
 *   operation: 'process',
 *   destination: 'orders'
 * })(ctx => async (message: { orderId: string; items: object[] }) => {
 *   ctx.setAttribute('messaging.message.id', message.orderId)
 *   ctx.setAttribute('messaging.message.body.size', JSON.stringify(message).length)
 *
 *   // Process order logic
 *   const result = await processOrderInternal(message)
 *
 *   ctx.setAttribute('messaging.operation.result', 'success')
 *   return result
 * })
 * ```
 *
 * @example AWS SQS with batch processing
 * ```typescript
 * import { traceMessaging } from 'autotel/semantic-helpers'
 * import { SQS } from '@aws-sdk/client-sqs'
 *
 * const sqs = new SQS()
 *
 * export const sendBatch = traceMessaging({
 *   system: 'aws_sqs',
 *   operation: 'publish',
 *   destination: 'notifications-queue'
 * })(ctx => async (messages: Array<{ id: string; body: object }>) => {
 *   ctx.setAttribute('messaging.batch.message_count', messages.length)
 *
 *   const result = await sqs.sendMessageBatch({
 *     QueueUrl: process.env.QUEUE_URL,
 *     Entries: messages.map(msg => ({
 *       Id: msg.id,
 *       MessageBody: JSON.stringify(msg.body)
 *     }))
 *   })
 *
 *   ctx.setAttribute('messaging.operation.success_count', result.Successful?.length || 0)
 *   ctx.setAttribute('messaging.operation.failed_count', result.Failed?.length || 0)
 *
 *   return result
 * })
 * ```
 *
 * @public
 */
export function traceMessaging<TArgs extends unknown[], TReturn>(
  config: MessagingConfig,
) {
  return (
    fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>((ctx) => {
      // Set semantic convention attributes
      ctx.setAttribute('messaging.system', config.system);
      if (config.operation) {
        ctx.setAttribute('messaging.operation', config.operation);
      }
      if (config.destination) {
        ctx.setAttribute('messaging.destination.name', config.destination);
      }
      if (config.attributes) {
        for (const [key, value] of Object.entries(config.attributes)) {
          if (value !== undefined && value !== null) {
            // setAttribute only accepts primitives (string | number | boolean)
            // Arrays and objects should be serialized
            const attrValue =
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean'
                ? value
                : JSON.stringify(value);
            ctx.setAttribute(key, attrValue);
          }
        }
      }

      // Call the user's factory to get their function and return it
      return fnFactory(ctx);
    });
  };
}
