import { init, track, flush, shutdown } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { EventSubscriber, type EventPayload } from 'autotel-subscribers';

const exporter = new InMemorySpanExporter();

// A subscriber is ~10 lines: extend EventSubscriber, implement
// sendToDestination(). The base class handles error handling,
// pending-request tracking, and graceful shutdown.
class ConsoleSubscriber extends EventSubscriber {
  readonly name = 'ConsoleSubscriber';
  received: EventPayload[] = [];

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    this.received.push(payload);
    console.log(`  → [${this.name}] ${payload.type}: ${payload.name}`);
  }
}

const consoleSubscriber = new ConsoleSubscriber();

async function main() {
  console.log('=== Chapter 30: Subscribers & Output Adapters ===\n');

  // Subscribers plug into init() — every track() call fans out to all of
  // them. Swap ConsoleSubscriber for PostHogSubscriber, MixpanelSubscriber,
  // SlackSubscriber, WebhookSubscriber, ... without touching call sites.
  init({
    service: 'book-30',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    subscribers: [consoleSubscriber],
  });

  track('user.signed_up', { 'user.id': '42', 'user.tier': 'premium' });
  track('order.placed', { 'order.id': 'ord_123', 'order.total': 2999 });

  // Events are queued asynchronously; shutdown() drains the queue.
  await flush();
  await shutdown();

  console.log(
    `\n  Events delivered to subscriber: ${consoleSubscriber.received.length}`,
  );
  if (consoleSubscriber.received.length !== 2) {
    throw new Error(
      `Expected 2 delivered events, got ${consoleSubscriber.received.length}`,
    );
  }
  console.log('✓ track() → EventSubscriber.sendToDestination() round trip');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
