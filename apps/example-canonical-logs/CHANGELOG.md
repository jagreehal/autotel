# @jagreehal/example-canonical-logs

## 1.0.4

### Patch Changes

- Updated dependencies [47c70fb]
  - autotel@2.14.0

## 1.0.3

### Patch Changes

- Updated dependencies [8256dac]
  - autotel@2.13.0

## 1.0.2

### Patch Changes

- Updated dependencies [3e12422]
  - autotel@2.12.1

## 1.0.1

### Patch Changes

- Updated dependencies [8831cf8]
  - autotel@2.12.0

## 1.1.0

### Minor Changes

- 92206af: Add canonical log lines (wide events) feature to automatically emit spans as comprehensive log records. Implements the "canonical log line" pattern: one log line per request with all context, making logs queryable as structured data instead of requiring string search.

  **autotel:**
  - New `canonicalLogLines` option in `init()` config
  - `CanonicalLogLineProcessor` for automatic span-to-log conversion
  - Supports root spans only, custom message format, min level filtering
  - Works with any logger (Pino, Winston) or OTel Logs API

  **@jagreehal/example-canonical-logs:**
  - New demo app showcasing canonical log lines vs traditional logging
  - Demonstrates the difference between scattered log lines and one wide event per request

### Patch Changes

- Updated dependencies [92206af]
  - autotel@2.11.0
