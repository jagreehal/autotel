# Example Subscribers

This application demonstrates how to use autotel event subscribers to send product events to various platforms.

## Available Examples

### PostHog Subscriber (`src/posthog.ts`)

Demonstrates sending events to PostHog with the official adapter.

**Setup:**
1. Sign up for PostHog at https://posthog.com
2. Get your Project API key (starts with `phc_`)
3. Add to `.env`:
   ```
   POSTHOG_KEY=phc_your_key_here
   POSTHOG_HOST=https://us.i.posthog.com  # or https://eu.i.posthog.com
   POSTHOG_ENV_ID=your_env_id
   ```

**Run:**
```bash
pnpm start:posthog
```

**What it demonstrates:**
- Tracking product view events
- Funnel step tracking (checkout flow)
- Outcome tracking (payment success/failure)
- Value tracking (revenue attribution)

### Slack Subscriber (`src/slack.ts`)

Demonstrates sending selective events alerts to Slack channels.

**Setup:**
1. Create a Slack App at https://api.slack.com/apps
2. Enable "Incoming Webhooks"
3. Add webhook to your workspace
4. Copy the webhook URL (format: `https://hooks.slack.com/services/T.../B.../XXX`)
5. Add to `.env`:
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your_webhook_url
   SLACK_CHANNEL_ID=C09QWK5PXT2  # optional override
   ```

**Run:**
```bash
pnpm start:slack
```

**What it demonstrates:**
- Filtering events to avoid noisy channels (only high-value orders and failures)
- Outcome tracking for failure alerts
- Value tracking for revenue notifications
- Custom Slack message formatting

**Note:** The adapter requires an **Incoming Webhook URL**, not a bot token. Bot tokens (`xoxb-...`) use the Slack Web API which requires different configuration.

### Webhook Server (`src/webhook-server.ts`)

Demonstrates the WebhookSubscriber with a self-contained local server.

**Setup:**
No external services required! This example creates both the webhook sender and receiver in one process.

**Run:**
```bash
pnpm start:webhook
```

**What it demonstrates:**
- Creating a webhook receiver endpoint
- Sending events through WebhookSubscriber
- Testing webhook integration locally
- Custom headers for webhook authentication

**Endpoints:**
- `GET /health` - Health check
- `POST /webhook` - Receives webhook payloads
- `POST /trigger` - Triggers demo events

**Test manually:**
```bash
# Test webhook receiver directly
curl -X POST http://localhost:4100/webhook \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
```

**Known Limitation:** The trigger endpoint (`/trigger`) creates a self-referential loop where the server tries to POST to itself while handling a request, causing a deadlock due to Node.js single-threaded nature. The webhook receiver endpoint works fine when called externally.

## Running the Examples

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your credentials in `.env`

3. Build the required packages:
   ```bash
   # From monorepo root
   pnpm build
   ```

4. Run any example:
   ```bash
   pnpm start:posthog
   pnpm start:slack
   pnpm start:webhook
   ```

## Architecture Notes

### Events Queue Pattern
All subscribers use an async queue pattern:
- Events are queued immediately and return to the caller
- A background worker processes the queue
- Multiple adapters can be configured simultaneously
- Graceful shutdown waits for queue to drain

### Filtering Events
Each subscriber supports filtering to control which events are sent:
```typescript
new SlackSubscriber({
  webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  filter: (payload) => {
    // Only send failures and high-value events
    if (payload.type === 'outcome' && payload.outcome === 'failure') {
      return true;
    }
    if (payload.type === 'event' && payload.attributes?.amount > 500) {
      return true;
    }
    return false;
  }
})
```

### Graceful Shutdown
All examples implement proper cleanup:
- Flush pending events
- Shutdown OpenTelemetry SDK
- Close HTTP servers
- Handle SIGINT/SIGTERM signals

## Troubleshooting

**"Package subpath './slack' is not defined by exports"**
- Run `pnpm build` from the monorepo root to build all packages

**"ECONNREFUSED on localhost:4318"**
- This is expected if you don't have a local OTLP collector running
- The events functionality still works; this only affects OpenTelemetry traces
- To fix: Run a local OTLP collector or set `OTLP_ENDPOINT` to a remote endpoint

**PostHog events not appearing**
- Check your `POSTHOG_KEY` is correct (should start with `phc_`)
- Verify `POSTHOG_HOST` matches your PostHog instance region
- Events may take a few seconds to appear in PostHog UI

**Slack messages not sending**
- Ensure you're using an Incoming Webhook URL (not a bot token)
- Verify the webhook URL format: `https://hooks.slack.com/services/...`
- Check that the webhook is still active in your Slack app settings
