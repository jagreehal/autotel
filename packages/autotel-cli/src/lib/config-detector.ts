import * as path from 'node:path';
import type { ConfigDetection, InstrumentationFile, InstrumentationSection } from '../types/index.js';
import { fileExists, readFileSafe } from './fs.js';
import { hasCliOwnershipHeader, getSectionMarkers } from './code-builder.js';

/**
 * Common instrumentation file locations
 */
const INSTRUMENTATION_LOCATIONS = [
  'src/instrumentation.mts',
  'src/instrumentation.ts',
  'src/instrumentation.mjs',
  'src/instrumentation.js',
  'instrumentation.mts',
  'instrumentation.ts',
  'instrumentation.mjs',
  'instrumentation.js',
];

/**
 * Find instrumentation file
 */
export function findInstrumentationFile(packageRoot: string): InstrumentationFile | null {
  for (const location of INSTRUMENTATION_LOCATIONS) {
    const filePath = path.join(packageRoot, location);
    if (fileExists(filePath)) {
      const content = readFileSafe(filePath);
      if (content === null) {
        continue;
      }

      const isCliOwned = hasCliOwnershipHeader(content);
      const markerStrings = getSectionMarkers(content);
      const sections = markerStrings.filter((m): m is InstrumentationSection =>
        ['BACKEND', 'PLUGINS', 'SUBSCRIBERS', 'BACKEND_CONFIG', 'SUBSCRIBERS_CONFIG', 'PLUGIN_INIT'].includes(m)
      );

      return {
        path: filePath,
        isCliOwned,
        sections,
      };
    }
  }

  return null;
}

/**
 * Check for autotel.yaml config
 */
export function findAutotelYaml(packageRoot: string): string | null {
  const candidates = ['autotel.yaml', 'autotel.yml', '.autotelrc.yaml', '.autotelrc.yml'];
  for (const candidate of candidates) {
    const filePath = path.join(packageRoot, candidate);
    if (fileExists(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Detect existing configuration
 */
export function detectConfig(packageRoot: string): ConfigDetection {
  // Check for CLI-owned instrumentation file
  const instrumentationFile = findInstrumentationFile(packageRoot);
  if (instrumentationFile?.isCliOwned) {
    return {
      found: true,
      type: 'cli-owned',
      path: instrumentationFile.path,
      instrumentationFile,
    };
  }

  // Check for user-created instrumentation file
  if (instrumentationFile && !instrumentationFile.isCliOwned) {
    return {
      found: true,
      type: 'user-created',
      path: instrumentationFile.path,
      instrumentationFile,
    };
  }

  // Check for autotel.yaml
  const yamlPath = findAutotelYaml(packageRoot);
  if (yamlPath) {
    return {
      found: true,
      type: 'autotel-yaml',
      path: yamlPath,
      instrumentationFile: null,
    };
  }

  return {
    found: false,
    type: 'none',
    path: null,
    instrumentationFile: null,
  };
}

/**
 * Check if a specific feature is already configured
 */
export function isFeatureConfigured(
  instrumentationFile: InstrumentationFile,
  feature: 'backend' | 'subscriber' | 'plugin' | 'platform'
): boolean {
  switch (feature) {
    case 'backend':
    case 'platform':
      return instrumentationFile.sections.includes('BACKEND') ||
             instrumentationFile.sections.includes('BACKEND_CONFIG');
    case 'subscriber':
      return instrumentationFile.sections.includes('SUBSCRIBERS') ||
             instrumentationFile.sections.includes('SUBSCRIBERS_CONFIG');
    case 'plugin':
      return instrumentationFile.sections.includes('PLUGINS') ||
             instrumentationFile.sections.includes('PLUGIN_INIT');
  }
}
