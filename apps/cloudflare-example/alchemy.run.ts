import alchemy from 'alchemy';
import { Worker, DurableObjectNamespace } from 'alchemy/cloudflare';

const app = await alchemy('cloudflare-example');

// Main worker with all the standard examples
export const worker = await Worker('hello-worker', {
  entrypoint: './src/worker.ts',
  compatibilityFlags: ['nodejs_compat'],
});

// Durable Object namespace for the CounterActor
// Using SQLite storage as required by @cloudflare/actors
const counterActorNamespace = DurableObjectNamespace('counter-actor', {
  className: 'CounterActor',
  sqlite: true,
});

// Actor worker with Durable Object binding
export const actorWorker = await Worker('counter-actor-worker', {
  entrypoint: './src/actor-worker.ts',
  compatibilityFlags: ['nodejs_compat'],
  bindings: {
    CounterActor: counterActorNamespace,
  },
});

// Durable Object namespace for the TaskAgent
// Using SQLite storage as required by the Agents SDK
const taskAgentNamespace = DurableObjectNamespace('task-agent', {
  className: 'TaskAgent',
  sqlite: true,
});

// Agent worker with Durable Object binding
export const agentWorker = await Worker('task-agent-worker', {
  entrypoint: './src/agent-worker.ts',
  compatibilityFlags: ['nodejs_compat'],
  bindings: {
    TaskAgent: taskAgentNamespace,
  },
});

console.log(`Main worker deployed at: ${worker.url}`);
console.log(`Actor worker deployed at: ${actorWorker.url}`);
console.log(`Agent worker deployed at: ${agentWorker.url}`);
await app.finalize();
