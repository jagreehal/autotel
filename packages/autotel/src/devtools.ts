export interface AutotelDevtoolsConfig {
  enabled?: boolean;
  endpoint?: string;
  embedded?: boolean;
  host?: string;
  port?: number;
  verbose?: boolean;
}

export interface ResolvedAutotelDevtoolsConfig {
  enabled: boolean;
  endpoint?: string;
  embedded: boolean;
  host: string;
  port: number;
  verbose: boolean;
}

const defaultHost = '127.0.0.1';
const defaultPort = 4318;

export function resolveDevtoolsConfig(
  config: boolean | AutotelDevtoolsConfig | undefined,
): ResolvedAutotelDevtoolsConfig {
  if (!config) {
    return {
      enabled: false,
      endpoint: undefined,
      embedded: false,
      host: defaultHost,
      port: defaultPort,
      verbose: false,
    };
  }

  if (config === true) {
    return {
      enabled: true,
      endpoint: `http://${defaultHost}:${defaultPort}`,
      embedded: false,
      host: defaultHost,
      port: defaultPort,
      verbose: false,
    };
  }

  const enabled = config.enabled ?? true;
  const host = config.host ?? defaultHost;
  const port = config.port ?? defaultPort;
  const endpoint = config.endpoint ?? `http://${host}:${port}`;

  return {
    enabled,
    endpoint: enabled ? endpoint : undefined,
    embedded: enabled && (config.embedded ?? false),
    host,
    port,
    verbose: config.verbose ?? false,
  };
}
