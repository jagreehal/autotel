# autotel-plugins

## 0.6.4

### Patch Changes

- Updated dependencies [745ab4c]
  - autotel@2.5.0

## 0.6.3

### Patch Changes

- Updated dependencies [31edf41]
  - autotel@2.4.0

## 0.6.2

### Patch Changes

- Updated dependencies [38f0462]
  - autotel@2.4.0

## 0.6.1

### Patch Changes

- Updated dependencies [bb7c547]
  - autotel@2.3.0

## 0.6.0

### Minor Changes

- 79f49aa: Updated example

### Patch Changes

- Updated dependencies [79f49aa]
  - autotel@2.2.0

## 0.5.0

### Minor Changes

- ec3b0c7: Add YAML configuration support and zero-config auto-instrumentation
  - **YAML Configuration**: Configure autotel via `autotel.yaml` files with environment variable substitution
  - **Zero-config setup**: New `autotel/auto` entry point for automatic initialization from YAML or environment variables
  - **ESM loader registration**: New `autotel/register` entry point for easier ESM instrumentation setup without NODE_OPTIONS
  - **Improved CommonJS compatibility**: Better support for CommonJS plugins and instrumentations

## Released

Initial release as `autotel-plugins` (renamed from `autotel-plugins`).
