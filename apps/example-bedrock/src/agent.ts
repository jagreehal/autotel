import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { stepCountIs, tool, ToolLoopAgent } from 'ai';
import { z } from 'zod';

export const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

const customers = [
  { id: 'c-100', name: 'Acme Ltd' },
  { id: 'c-200', name: 'Northwind Traders' },
];

const orders = [
  {
    customerId: 'c-100',
    reference: 'ORD-4616',
    status: 'shipped',
    total: 249.0,
  },
  {
    customerId: 'c-100',
    reference: 'ORD-4702',
    status: 'on_hold',
    total: 1180.5,
  },
  {
    customerId: 'c-200',
    reference: 'ORD-4651',
    status: 'delivered',
    total: 88.2,
  },
];

const findCustomer = tool({
  description: 'Find a customer by (partial) name. Returns id and name.',
  inputSchema: z.object({ name: z.string() }),
  execute: async ({ name }) =>
    customers.filter((c) => c.name.toLowerCase().includes(name.toLowerCase())),
});

const getRecentOrders = tool({
  description: 'Recent orders for a customer id, newest first.',
  inputSchema: z.object({
    customerId: z.string(),
    limit: z.number().default(5),
  }),
  execute: async ({ customerId, limit }) =>
    orders.filter((o) => o.customerId === customerId).slice(0, limit),
});

// The default AWS credential chain: the Lambda role in production, a profile
// or SSO session locally. AWS_BEARER_TOKEN_BEDROCK works too.
const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentialProvider: fromNodeProviderChain(),
});

export const agent = new ToolLoopAgent({
  model: bedrock(MODEL_ID),
  instructions:
    'You answer questions about customers and their orders. Find the customer first, then use the order tool. Every fact comes from a tool result; quote references and statuses verbatim. Answer in one or two sentences.',
  tools: { findCustomer, getRecentOrders },
  stopWhen: stepCountIs(6),
  telemetry: { functionId: 'orders-agent' },
});
