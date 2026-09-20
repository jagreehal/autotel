/**
 * The Lambda entry. `wrapHandler` opens the root span, reads the trigger and
 * cold-start facts, and flushes telemetry before the handler returns, since
 * Lambda freezes the sandbox on return.
 */
import './telemetry.js';
import { wrapHandler } from 'autotel-aws/lambda';
import { agent } from './agent.js';

export interface AskEvent {
  prompt: string;
}

export const handler = wrapHandler(async (event: AskEvent) => {
  const result = await agent.generate({ prompt: event.prompt });
  return { statusCode: 200, body: result.text };
});
