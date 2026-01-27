import type { Import } from '../types/index.js';

/**
 * CLI ownership header comment
 */
const CLI_HEADER = `/**
 * autotel instrumentation - managed by autotel-cli
 * Run \`autotel add <feature>\` to update this file
 */`;

/**
 * Section marker format
 */
const SECTION_MARKER = (name: string): string => `// --- AUTOTEL:${name} ---`;

/**
 * Code file structure
 */
export interface CodeFile {
  imports: Import[];
  backendImports: Import[];
  pluginImports: Import[];
  subscriberImports: Import[];
  backendConfig: string | null;
  subscribersConfig: string[];
  pluginInit: string[];
}

/**
 * Create empty code file
 */
export function createCodeFile(): CodeFile {
  return {
    imports: [],
    backendImports: [],
    pluginImports: [],
    subscriberImports: [],
    backendConfig: null,
    subscribersConfig: [],
    pluginInit: [],
  };
}

/**
 * Add import to code file
 */
export function addImport(file: CodeFile, imp: Import, section?: 'backend' | 'plugin' | 'subscriber'): void {
  switch (section) {
    case 'backend':
      file.backendImports.push(imp);
      break;
    case 'plugin':
      file.pluginImports.push(imp);
      break;
    case 'subscriber':
      file.subscriberImports.push(imp);
      break;
    default:
      file.imports.push(imp);
  }
}

/**
 * Set backend config
 */
export function setBackendConfig(file: CodeFile, config: string): void {
  file.backendConfig = config;
}

/**
 * Add subscriber config
 */
export function addSubscriberConfig(file: CodeFile, config: string): void {
  file.subscribersConfig.push(config);
}

/**
 * Add plugin init
 */
export function addPluginInit(file: CodeFile, init: string): void {
  file.pluginInit.push(init);
}

/**
 * Sort imports for stable output
 * Order: side-effect (autotel/register first), external packages, relative imports
 */
function sortImports(imports: Import[]): Import[] {
  const sideEffect: Import[] = [];
  const external: Import[] = [];
  const relative: Import[] = [];

  for (const imp of imports) {
    if (imp.sideEffect) {
      // autotel/register should be first among side-effects
      if (imp.source === 'autotel/register') {
        sideEffect.unshift(imp);
      } else {
        sideEffect.push(imp);
      }
    } else if (imp.source.startsWith('.') || imp.source.startsWith('/')) {
      relative.push(imp);
    } else {
      external.push(imp);
    }
  }

  // Sort each group alphabetically by source
  const sortBySource = (a: Import, b: Import): number => a.source.localeCompare(b.source);
  external.sort(sortBySource);
  relative.sort(sortBySource);

  return [...sideEffect, ...external, ...relative];
}

/**
 * Render single import statement
 */
function renderImport(imp: Import): string {
  if (imp.sideEffect) {
    return `import '${imp.source}';`;
  }

  const parts: string[] = [];

  if (imp.default) {
    parts.push(imp.default);
  }

  if (imp.specifiers && imp.specifiers.length > 0) {
    const specifiers = imp.specifiers.join(', ');
    parts.push(`{ ${specifiers} }`);
  }

  if (parts.length === 0) {
    return `import '${imp.source}';`;
  }

  return `import ${parts.join(', ')} from '${imp.source}';`;
}

/**
 * Render imports section
 */
function renderImports(imports: Import[]): string {
  if (imports.length === 0) {
    return '';
  }
  const sorted = sortImports(imports);
  return sorted.map(renderImport).join('\n');
}

/**
 * Render code file to string
 */
export function renderCodeFile(file: CodeFile): string {
  const lines: string[] = [];

  // Header
  lines.push(CLI_HEADER);
  lines.push('');

  // Main imports (autotel/register first)
  const mainImports = sortImports(file.imports);
  if (mainImports.length > 0) {
    lines.push(renderImports(mainImports));
    lines.push('');
  }

  // Backend imports
  if (file.backendImports.length > 0) {
    lines.push(SECTION_MARKER('BACKEND'));
    lines.push(renderImports(file.backendImports));
    lines.push('');
  }

  // Plugin imports
  if (file.pluginImports.length > 0) {
    lines.push(SECTION_MARKER('PLUGINS'));
    lines.push(renderImports(file.pluginImports));
    lines.push('');
  }

  // Subscriber imports
  if (file.subscriberImports.length > 0) {
    lines.push(SECTION_MARKER('SUBSCRIBERS'));
    lines.push(renderImports(file.subscriberImports));
    lines.push('');
  }

  // Init call
  lines.push('init({');

  // Backend config
  if (file.backendConfig) {
    lines.push('  ' + SECTION_MARKER('BACKEND_CONFIG'));
    lines.push(`  ${file.backendConfig}`);
  }

  // Subscribers config
  if (file.subscribersConfig.length > 0) {
    lines.push('');
    lines.push('  ' + SECTION_MARKER('SUBSCRIBERS_CONFIG'));
    lines.push('  subscribers: [');
    for (const sub of file.subscribersConfig) {
      lines.push(`    ${sub}`);
    }
    lines.push('  ],');
  }

  lines.push('});');

  // Plugin init
  if (file.pluginInit.length > 0) {
    lines.push('');
    lines.push(SECTION_MARKER('PLUGIN_INIT'));
    for (const init of file.pluginInit) {
      lines.push(init);
    }
  }

  // Ensure file ends with newline
  lines.push('');

  return lines.join('\n');
}

/**
 * Check if content has CLI ownership header
 */
export function hasCliOwnershipHeader(content: string): boolean {
  return content.includes('autotel instrumentation - managed by autotel-cli');
}

/**
 * Check if content has a specific section marker
 */
export function hasSectionMarker(content: string, section: string): boolean {
  return content.includes(SECTION_MARKER(section));
}

/**
 * Get all section markers present in content
 */
export function getSectionMarkers(content: string): string[] {
  const markers: string[] = [];
  const regex = /\/\/ --- AUTOTEL:(\w+) ---/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) {
      markers.push(match[1]);
    }
  }
  return markers;
}

/**
 * Build minimal instrumentation file (for --yes defaults)
 */
export function buildMinimalInstrumentation(): string {
  const file = createCodeFile();

  // Add core imports
  addImport(file, { source: 'autotel/register', sideEffect: true });
  addImport(file, { source: 'autotel', specifiers: ['init'] });

  // No backend config for local/console default
  file.backendConfig = '// Local/console mode - no backend configured';

  return renderCodeFile(file);
}
