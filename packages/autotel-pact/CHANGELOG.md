# autotel-pact

## 1.0.2

### Patch Changes

- Updated dependencies [bb9a1b7]
  - autotel@3.4.2

## 1.0.1

### Patch Changes

- Updated dependencies [ea2cb4a]
  - autotel@3.4.1

## 1.0.0

### Patch Changes

- Updated dependencies [20a1186]
  - autotel@3.4.0

## 0.2.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1
