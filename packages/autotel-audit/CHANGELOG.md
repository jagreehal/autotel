# autotel-audit

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
