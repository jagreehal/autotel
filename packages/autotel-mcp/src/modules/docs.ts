import { buildToolCatalog } from './tool-catalog.js';
import { buildCapabilitiesDocument } from './capabilities.js';
import type { BackendCapabilities } from '../types.js';

export function buildVerificationGuide(): string {
  return [
    'Primary backend: Jaeger from /Users/jreehal/dev/curve/payments-dbos/docker-compose-jaeger.yml.',
    'Smoke path: npm run smoke:jaeger.',
    'Fixture mode: BACKEND_MODE=fixture npm run start:http with ./fixtures/telemetry.json.',
    'Unit tests cover config, module logic, Jaeger payload normalization, and trace filtering.',
    'Use live traces for deterministic integration coverage, and use golden fixtures when backend-specific output varies.',
    'The backend contract exposes traces, metrics, and logs, and the fixture backend exercises all three signals.',
    'Traceloop-equivalent analytics include token usage, model discovery, model stats, error summaries, expensive traces, slow traces, and tool usage.',
  ].join(' ');
}

export function buildCollectorGuide(): string {
  return [
    'OTLP receiver config should expose grpc on 4317 and http on 4318.',
    'Prefer explicit traces_url_path, metrics_url_path, and logs_url_path when customizing routes.',
    'Treat malformed config as a hard failure; the model should get a precise reason and suggested fix.',
  ].join(' ');
}

export function buildInstrumentationGuide(): string {
  return [
    'High-quality spans should have stable service names, useful operation names, correlation tags, and status codes.',
    'Semantic convention tags such as http.method, rpc.system, and db.system improve searchability.',
    'Scoring is opinionated: the goal is to surface missing context, not to grade style.',
  ].join(' ');
}

export function buildBackendCapabilitiesText(
  capabilities: BackendCapabilities,
): string {
  return JSON.stringify(capabilities, null, 2);
}

export function buildCapabilitiesText(serverName: string): string {
  return JSON.stringify(buildCapabilitiesDocument(serverName), null, 2);
}

export function buildToolCatalogText(): string {
  return JSON.stringify(buildToolCatalog(), null, 2);
}
