# autotel-audit

## 0.2.1

### Patch Changes

- Updated dependencies [47a69ac]
  - autotel@3.6.0

## 0.2.0

### Minor Changes

- 1c43d26: Add typed security events (OWASP A09-aligned): `securityEvent()`, `withSecurity()`, `hashIdentifier()`, and a zero-code `createSecuritySignalProcessor()`.

  Security events emit a stable `security.*` attribute schema (`security.event`, `security.category`, `security.outcome`, `security.severity`), are exempt from tail sampling by default, never emit values under credential-shaped keys (reusing autotel core's `REDACTOR_PATTERNS.sensitiveKey`), and feed the `autotel.security.events` counter so security teams can alert on rates. `hashIdentifier()` provides stable one-way digests so PII-bearing identifiers (emails, IPs) can be correlated across events without being logged raw.

  `createSecuritySignalProcessor()` derives security signals from existing HTTP spans with no per-route code: flags suspicious request paths (traversal, `.env`/`.git` probes, SQLi/XSS probes) and force-keeps them through tail sampling, counts denied responses (401/403/429) into `autotel.security.http.denied`, and detects per-client auth-failure bursts via a bounded sliding window (`autotel.security.anomaly` + `onSignal` callback).

### Patch Changes

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0

## 0.1.14

### Patch Changes

- Updated dependencies [bb9a1b7]
  - autotel@3.4.2

## 0.1.13

### Patch Changes

- Updated dependencies [ea2cb4a]
  - autotel@3.4.1

## 0.1.12

### Patch Changes

- Updated dependencies [20a1186]
  - autotel@3.4.0

## 0.1.11

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1

## 0.1.10

### Patch Changes

- Updated dependencies [30a485b]
  - autotel@3.3.0

## 0.1.9

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0

## 0.1.8

### Patch Changes

- Updated dependencies [3966db0]
  - autotel@3.1.1

## 0.1.7

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0

## 0.1.6

### Patch Changes

- Updated dependencies [ee60622]
  - autotel@3.0.7

## 0.1.5

### Patch Changes

- Updated dependencies [8d5d84d]
  - autotel@3.0.6

## 0.1.4

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel@3.0.5

## 0.1.3

### Patch Changes

- Updated dependencies [3a21282]
  - autotel@3.0.4

## 0.1.2

### Patch Changes

- Updated dependencies [5e146a7]
  - autotel@3.0.3

## 0.1.1

### Patch Changes

- 5999cb9: Add audit logging capabilities and enhance documentation:
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

- Updated dependencies [5999cb9]
  - autotel@3.0.2
