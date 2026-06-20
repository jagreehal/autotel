# example-agent-security

Demonstrates Google Secure AI Agents observability patterns with Autotel:

- Human control: `recordControllerId`, `recordHumanApproval`, `recordInputProvenance`
- Limited powers: `withScopedTool` denial, `createGenAiBudget` guard stop
- Observable actions: MCP classifier + `createMcpSecurityEventBridge`, observer plan/memory/render events

```bash
pnpm --filter @jagreehal/example-agent-security start
```

See [docs/AGENT-SECURITY-OBSERVABILITY.md](../../docs/AGENT-SECURITY-OBSERVABILITY.md).
