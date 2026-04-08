export function getResourceName(
  resource: Record<string, unknown> | undefined,
  fallback = 'unknown',
): string {
  if (!resource) return fallback

  const candidates = [
    resource['service.name'],
    resource['service.namespace'],
    resource['deployment.environment.name'],
    resource['host.name'],
    resource['container.name'],
    resource['process.executable.name'],
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }

  return fallback
}
