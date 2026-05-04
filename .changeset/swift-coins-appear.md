---
'autotel-mcp-instrumentation': patch
'autotel-subscribers': patch
'autotel-cloudflare': patch
'autotel-adapters': patch
'autotel-backends': patch
'autotel-mongoose': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-drizzle': patch
'autotel-plugins': patch
'autotel-vitest': patch
'autotel-edge': patch
'autotel-mcp': patch
'autotel-web': patch
'autotel': patch
'autotel-audit': patch
'autotel-docs': patch
---

Add audit logging capabilities and enhance documentation:

- **New `autotel-audit` package**: Structured audit logging with compliance-ready features
  - `withAudit()` for wrapping operations with audit metadata and automatic outcome tagging
  - `forceKeepAuditEvent()` to bypass tail-drop sampling for critical audit trails
  - `setAuditAttributes()` for normalized `audit.*` span attributes
  - Type-safe metadata schemas and backend integration support

- **Documentation enhancements**: 
  - Comprehensive integration guide for audit logging
  - Framework-specific setup examples (Express, Fastify, NestJS, Next.js, TanStack)
  - API reference with compliance and sampling strategies
  - Updated documentation site navigation

- **Runtime helpers and edge improvements**: Enhanced execution logging and request handling across edge runtimes and frameworks
