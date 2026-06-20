/**
 * Base event structure for all Cloudflare Agents observability events.
 */
export type BaseEvent<
  T extends string,
  Payload extends Record<string, unknown> = Record<string, never>,
> = {
  type: T;
  /**
   * The class name of the agent that emitted this event
   * (e.g. "MyChatAgent").
   */
  agent?: string;
  /**
   * The instance name (Durable Object ID name) of the agent.
   */
  name?: string;
  /**
   * Optional legacy fields accepted by the Cloudflare adapter so older
   * examples can still be observed without reshaping the event.
   */
  id?: string;
  displayMessage?: string;
  payload: Payload;
  timestamp: number;
};
