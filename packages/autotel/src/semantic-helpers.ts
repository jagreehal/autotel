/**
 * Semantic convention helpers for OpenTelemetry
 *
 * Pre-configured trace helpers that follow OpenTelemetry semantic conventions
 * for common operation types. Reduces boilerplate and ensures consistency.
 *
 * Based on: https://opentelemetry.io/docs/specs/semconv/
 */

import { withTracing } from './functional';
import { assertTraceFactory } from './trace-factory-validation';
import type { TraceContext } from './trace-context';
import { SpanKind, type Attributes } from '@opentelemetry/api';

type SemanticHandler<TArgs extends unknown[], TReturn> = (
  ...args: TArgs
) => TReturn | Promise<TReturn>;

type SemanticFactory<TArgs extends unknown[], TReturn> = (
  ctx: TraceContext,
) => SemanticHandler<TArgs, TReturn>;

function setConfiguredAttributes(
  ctx: TraceContext,
  attributes?: Attributes,
): void {
  if (!attributes) return;
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    const attributeValue =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
        ? value
        : JSON.stringify(value);
    ctx.setAttribute(key, attributeValue);
  }
}

/**
 * Shared tail of `traceDB`/`traceHTTP`/`traceMessaging`: wrap `fn` directly
 * when given, otherwise return the curried factory-acceptor form.
 */
function wrapSemantic<TArgs extends unknown[], TReturn>(
  helperName: string,
  name: string,
  spanKind: SpanKind,
  configure: (ctx: TraceContext) => void,
  fn?: SemanticHandler<TArgs, TReturn>,
):
  | SemanticHandler<TArgs, TReturn>
  | (<TFactoryArgs extends unknown[], TFactoryReturn>(
      factory: SemanticFactory<TFactoryArgs, TFactoryReturn>,
    ) => SemanticHandler<TFactoryArgs, TFactoryReturn>) {
  if (fn) {
    assertTraceFactory(helperName, fn);
    return withTracing<TArgs, TReturn>({ name, spanKind })(
      (ctx: TraceContext) => {
        configure(ctx);
        return fn;
      },
    );
  }
  return <TFactoryArgs extends unknown[], TFactoryReturn>(
    factory: SemanticFactory<TFactoryArgs, TFactoryReturn>,
  ) => {
    assertTraceFactory(helperName, factory);
    return withTracing<TFactoryArgs, TFactoryReturn>({ name, spanKind })(
      (ctx: TraceContext) => {
        configure(ctx);
        const handler = factory(ctx);
        assertTraceFactory(helperName, handler, 'result');
        return handler;
      },
    );
  };
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
  /** Low-cardinality query summary used as the preferred span name */
  querySummary?: string;
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
  /** Low-cardinality server route used in the span name */
  route?: string;
  /** Low-cardinality client URL template used in the span name */
  urlTemplate?: string;
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
 * Trace database operations with DB semantic conventions
 *
 * Automatically adds standard attributes for database operations:
 * - db.system.name
 * - db.operation.name
 * - db.namespace
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
 *   collection: 'users',
 *   querySummary: 'SELECT users'
 * })(ctx => async (userId: string) => {
 *   const query = 'SELECT * FROM users WHERE id = $1'
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
export function traceDB(
  config: DBConfig,
): <TArgs extends unknown[], TReturn>(
  factory: SemanticFactory<TArgs, TReturn>,
) => SemanticHandler<TArgs, TReturn>;
export function traceDB<TArgs extends unknown[], TReturn>(
  config: DBConfig,
  fn: SemanticHandler<TArgs, TReturn>,
): SemanticHandler<TArgs, TReturn>;
export function traceDB<TArgs extends unknown[], TReturn>(
  config: DBConfig,
  fn?: SemanticHandler<TArgs, TReturn>,
):
  | SemanticHandler<TArgs, TReturn>
  | (<TFactoryArgs extends unknown[], TFactoryReturn>(
      factory: SemanticFactory<TFactoryArgs, TFactoryReturn>,
    ) => SemanticHandler<TFactoryArgs, TFactoryReturn>) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('traceDB: config must be an object');
  }
  if (typeof config.system !== 'string' || config.system.trim() === '') {
    throw new TypeError('traceDB: config.system must be a non-empty string');
  }
  const target = config.collection ?? config.database;
  const name =
    config.querySummary ?? [config.operation, target].filter(Boolean).join(' ');
  const spanName = name || config.system;
  const configure = (ctx: TraceContext) => {
    // Emit current stable names plus legacy aliases for dashboard compatibility.
    ctx.setAttribute('db.system.name', config.system);
    ctx.setAttribute('db.system', config.system);
    if (config.operation) {
      ctx.setAttribute('db.operation.name', config.operation);
      ctx.setAttribute('db.operation', config.operation);
    }
    if (config.database) {
      ctx.setAttribute('db.namespace', config.database);
      ctx.setAttribute('db.name', config.database);
    }
    if (config.collection) {
      ctx.setAttribute('db.collection.name', config.collection);
    }
    if (config.querySummary) {
      ctx.setAttribute('db.query.summary', config.querySummary);
    }
    setConfiguredAttributes(ctx, config.attributes);
  };
  return wrapSemantic('traceDB', spanName, SpanKind.CLIENT, configure, fn);
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
 *   urlTemplate: '/users/{id}'
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
export function traceHTTP(
  config: HTTPConfig,
): <TArgs extends unknown[], TReturn>(
  factory: SemanticFactory<TArgs, TReturn>,
) => SemanticHandler<TArgs, TReturn>;
export function traceHTTP<TArgs extends unknown[], TReturn>(
  config: HTTPConfig,
  fn: SemanticHandler<TArgs, TReturn>,
): SemanticHandler<TArgs, TReturn>;
export function traceHTTP<TArgs extends unknown[], TReturn>(
  config: HTTPConfig,
  fn?: SemanticHandler<TArgs, TReturn>,
):
  | SemanticHandler<TArgs, TReturn>
  | (<TFactoryArgs extends unknown[], TFactoryReturn>(
      factory: SemanticFactory<TFactoryArgs, TFactoryReturn>,
    ) => SemanticHandler<TFactoryArgs, TFactoryReturn>) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('traceHTTP: config must be an object');
  }
  const method = config.method?.toUpperCase() || 'HTTP';
  const target = config.route ?? config.urlTemplate;
  const spanName = target ? `${method} ${target}` : method;
  const configure = (ctx: TraceContext) => {
    if (config.method) ctx.setAttribute('http.request.method', method);
    if (config.url) ctx.setAttribute('url.full', config.url);
    if (config.route) ctx.setAttribute('http.route', config.route);
    if (config.urlTemplate) {
      ctx.setAttribute('url.template', config.urlTemplate);
    }
    setConfiguredAttributes(ctx, config.attributes);
  };
  return wrapSemantic('traceHTTP', spanName, SpanKind.CLIENT, configure, fn);
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
export function traceMessaging(
  config: MessagingConfig,
): <TArgs extends unknown[], TReturn>(
  factory: SemanticFactory<TArgs, TReturn>,
) => SemanticHandler<TArgs, TReturn>;
export function traceMessaging<TArgs extends unknown[], TReturn>(
  config: MessagingConfig,
  fn: SemanticHandler<TArgs, TReturn>,
): SemanticHandler<TArgs, TReturn>;
export function traceMessaging<TArgs extends unknown[], TReturn>(
  config: MessagingConfig,
  fn?: SemanticHandler<TArgs, TReturn>,
):
  | SemanticHandler<TArgs, TReturn>
  | (<TFactoryArgs extends unknown[], TFactoryReturn>(
      factory: SemanticFactory<TFactoryArgs, TFactoryReturn>,
    ) => SemanticHandler<TFactoryArgs, TFactoryReturn>) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('traceMessaging: config must be an object');
  }
  if (typeof config.system !== 'string' || config.system.trim() === '') {
    throw new TypeError(
      'traceMessaging: config.system must be a non-empty string',
    );
  }
  const operation = config.operation ?? 'messaging';
  const spanName = [operation, config.destination].filter(Boolean).join(' ');
  const operationType = operation === 'publish' ? 'send' : operation;
  const spanKind =
    operation === 'publish'
      ? SpanKind.PRODUCER
      : operation === 'process'
        ? SpanKind.CONSUMER
        : operation === 'receive'
          ? SpanKind.CLIENT
          : SpanKind.INTERNAL;
  const configure = (ctx: TraceContext) => {
    ctx.setAttribute('messaging.system', config.system);
    if (config.operation) {
      ctx.setAttribute('messaging.operation.name', config.operation);
      ctx.setAttribute('messaging.operation.type', operationType);
      ctx.setAttribute('messaging.operation', config.operation);
    }
    if (config.destination) {
      ctx.setAttribute('messaging.destination.name', config.destination);
    }
    setConfiguredAttributes(ctx, config.attributes);
  };
  return wrapSemantic('traceMessaging', spanName, spanKind, configure, fn);
}
