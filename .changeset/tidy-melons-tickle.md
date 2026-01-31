---
'autotel-subscribers': minor
'autotel-cloudflare': minor
'autotel-backends': minor
'autotel-tanstack': minor
'autotel-terminal': minor
'autotel-plugins': minor
'autotel-edge': minor
'autotel-aws': minor
'autotel-cli': minor
'autotel-mcp': minor
'autotel-web': minor
'autotel': minor
---

- **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
- **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
- **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.
