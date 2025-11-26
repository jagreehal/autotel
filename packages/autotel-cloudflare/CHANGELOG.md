# autotel-cloudflare

## 2.4.0

### Minor Changes

- bb7c547: Add support for array attributes in trace context

  Extended `setAttribute` and `setAttributes` methods to support array values (string[], number[], boolean[]) in addition to primitive values, aligning with OpenTelemetry's attribute specification. This allows setting attributes like tags, scores, or flags as arrays.

### Patch Changes

- Updated dependencies [bb7c547]
  - autotel-edge@3.2.0

## 2.3.0

### Minor Changes

- 79f49aa: Updated example

### Patch Changes

- Updated dependencies [79f49aa]
  - autotel-edge@3.1.0

## 2.2.0

### Minor Changes

- ec3b0c7: Add YAML configuration support and zero-config auto-instrumentation
  - **YAML Configuration**: Configure autotel via `autotel.yaml` files with environment variable substitution
  - **Zero-config setup**: New `autotel/auto` entry point for automatic initialization from YAML or environment variables
  - **ESM loader registration**: New `autotel/register` entry point for easier ESM instrumentation setup without NODE_OPTIONS
  - **Improved CommonJS compatibility**: Better support for CommonJS plugins and instrumentations

## Released

Initial release as `autotel-cloudflare` (renamed from `autotel-cloudflare`).
