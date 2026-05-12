---
'autotel-subscribers': minor
---

Add comprehensive middleware system and composition strategies for event subscribers

- New middleware system with 15+ composable factories: `retryMiddleware`, `rateLimitMiddleware`, `circuitBreakerMiddleware`, `batchingMiddleware`, `enrichmentMiddleware`, `filterMiddleware`, `transformMiddleware`, `samplingMiddleware`, `timeoutMiddleware`, `loggingMiddleware`, and more
- New composition strategies for multi-subscriber setups: `parallel`, `failover`, `round-robin`, `random`, `race`, and `mirrored`
- HTTP client abstraction with timeout support, proper error handling, and automatic response parsing
- Smart error classification: distinguishes between retriable (5xx, network, rate-limit) and non-retriable (4xx validation, auth) errors
- Idempotency and rate limiting stores with in-memory implementations
- Event logging middleware for audit trails and observability
- Comprehensive JSDoc documentation for all new APIs
