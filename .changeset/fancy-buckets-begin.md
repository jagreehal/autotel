---
'autotel-subscribers': minor
'autotel-cloudflare': minor
'autotel-backends': minor
'autotel-plugins': minor
---

Add YAML configuration support and zero-config auto-instrumentation

- **YAML Configuration**: Configure autotel via `autotel.yaml` files with environment variable substitution
- **Zero-config setup**: New `autotel/auto` entry point for automatic initialization from YAML or environment variables
- **ESM loader registration**: New `autotel/register` entry point for easier ESM instrumentation setup without NODE_OPTIONS
- **Improved CommonJS compatibility**: Better support for CommonJS plugins and instrumentations
