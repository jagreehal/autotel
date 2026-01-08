# Configuration Guide

Environment variables, YAML configuration, and configuration precedence for Autotel.

## Environment Variables

Autotel supports standard OpenTelemetry environment variables for configuration. This enables zero-code configuration changes across environments and compatibility with the broader OTEL ecosystem.

### Supported Environment Variables

**Service Configuration:**

- `OTEL_SERVICE_NAME` - Service name (maps to `service` in `init()`)

**Exporter Configuration:**

- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTLP collector URL (maps to `endpoint`)
  - Examples: `http://localhost:4318`, `https://api.honeycomb.io`
- `OTEL_EXPORTER_OTLP_PROTOCOL` - Protocol to use: `http` or `grpc` (maps to `protocol`)
- `OTEL_EXPORTER_OTLP_HEADERS` - Authentication headers as comma-separated key=value pairs
  - Format: `key1=value1,key2=value2`
  - Example: `x-honeycomb-team=YOUR_API_KEY`

**Resource Attributes:**

- `OTEL_RESOURCE_ATTRIBUTES` - Custom metadata tags as comma-separated key=value pairs
  - Common attributes: `service.version`, `deployment.environment`, `team`, `region`
  - Example: `service.version=1.0.0,deployment.environment=production`

### Configuration Precedence

Configuration is resolved in the following priority order (highest to lowest):

1. **Explicit `init()` parameters** - Direct code configuration
2. **YAML file** - `autotel.yaml` or `AUTOTEL_CONFIG_FILE` env var
3. **Environment variables** - `OTEL_*`, `AUTOTEL_*` env vars
4. **Built-in defaults** - Sensible defaults for development

```typescript
// Explicit config takes precedence over YAML and env vars
init({
  service: 'my-service', // Overrides YAML and OTEL_SERVICE_NAME
  endpoint: 'http://localhost:4318', // Overrides YAML and OTEL_EXPORTER_OTLP_ENDPOINT
});
```

### YAML Configuration

Autotel supports YAML file configuration for a declarative setup without code changes. Create an `autotel.yaml` file in your project root:

```yaml
# autotel.yaml
service:
  name: my-service
  version: 1.0.0
  environment: ${env:NODE_ENV:-development}

exporter:
  endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}
  protocol: http
  headers:
    x-honeycomb-team: ${env:HONEYCOMB_API_KEY}

resource:
  deployment.environment: ${env:NODE_ENV:-development}
  team: backend

autoInstrumentations:
  - express
  - http
  - pino

debug: false
```

**Key features:**

- **Auto-discovery**: Automatically loads `autotel.yaml` or `autotel.yml` from the current directory
- **Explicit path**: Set `AUTOTEL_CONFIG_FILE=./config/otel.yaml` to use a custom path
- **Environment variable substitution**: Use `${env:VAR_NAME}` or `${env:VAR_NAME:-default}` in YAML values
- **Programmatic loading**: Use `loadYamlConfigFromFile()` from `autotel/yaml` for custom loading

**Usage with autotel/auto (zero-config):**

```bash
# Just create autotel.yaml and run:
tsx --import autotel/auto src/index.ts
```

**Programmatic loading:**

```typescript
import { loadYamlConfigFromFile } from 'autotel/yaml';
import { init } from 'autotel';

const yamlConfig = loadYamlConfigFromFile('./config/otel.yaml');
init({ ...yamlConfig, debug: true });
```

See `packages/autotel/autotel.yaml.example` for a complete template.

### Example Usage

**Development (local collector):**

```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

**Production (Honeycomb):**

```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
export OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
export OTEL_RESOURCE_ATTRIBUTES=service.version=1.2.3,deployment.environment=production
```

**Production (Datadog):**

```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=https://http-intake.logs.datadoghq.com
export OTEL_EXPORTER_OTLP_HEADERS=DD-API-KEY=YOUR_API_KEY
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,team=backend
```

See `packages/autotel/.env.example` for a complete template.

### Implementation Details

**Environment variable resolution** is handled in `packages/autotel/src/env-config.ts`. The resolver:

- Validates env var formats (URLs, enum values)
- Parses complex values (comma-separated key=value pairs)
- Provides type-safe config objects

**YAML configuration** is handled in `packages/autotel/src/yaml-config.ts`. The loader:

- Auto-discovers `autotel.yaml` or `autotel.yml` in the current directory
- Supports `AUTOTEL_CONFIG_FILE` env var for custom paths
- Substitutes `${env:VAR}` and `${env:VAR:-default}` syntax in YAML values
- Converts YAML structure to `AutotelConfig` type

**Config merging** happens in `init()` with the priority: `explicit > yaml > env > defaults`
