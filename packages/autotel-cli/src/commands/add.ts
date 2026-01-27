import { execSync } from 'node:child_process';
import type { AddOptions, Preset, PresetType } from '../types/index';
import { discoverProject } from '../lib/project';
import { detectConfig, isFeatureConfigured } from '../lib/config-detector';
import { getInstallCommand } from '../lib/package-manager';
import { atomicWrite, readFileSafe } from '../lib/fs';
import {
  getPreset,
  getPresetsByType,
  listPresetSlugs,
} from '../presets/index';
import * as output from '../ui/output';
import { createSpinner } from '../ui/spinner';

/**
 * Format preset list for output
 */
function formatPresetList(presets: Map<string, Preset>, json: boolean): void {
  if (json) {
    const list = [...presets.entries()].map(([slug, preset]) => ({
      slug,
      name: preset.name,
      description: preset.description,
      requiredEnv: preset.env.required.map((e) => e.name),
    }));
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  for (const [slug, preset] of presets) {
    console.log(`  ${slug}`);
    console.log(`    ${preset.description}`);
    if (preset.env.required.length > 0) {
      const envNames = preset.env.required.map((e) => e.name).join(', ');
      output.dim(`    Required env: ${envNames}`);
    }
    console.log('');
  }
}

/**
 * Show help for a specific preset
 */
function showPresetHelp(preset: Preset): void {
  output.heading(`\n${preset.name}\n`);
  console.log(preset.description);
  console.log('');

  output.heading('Packages:');
  for (const pkg of preset.packages.required) {
    console.log(`  ${pkg}`);
  }
  if (preset.packages.optional.length > 0) {
    console.log('  Optional:');
    for (const pkg of preset.packages.optional) {
      console.log(`    ${pkg}`);
    }
  }
  console.log('');

  if (preset.env.required.length > 0) {
    output.heading('Required Environment Variables:');
    for (const envVar of preset.env.required) {
      console.log(`  ${envVar.name}`);
      console.log(`    ${envVar.description}`);
      if (envVar.example) {
        output.dim(`    Example: ${envVar.example}`);
      }
    }
    console.log('');
  }

  if (preset.env.optional.length > 0) {
    output.heading('Optional Environment Variables:');
    for (const envVar of preset.env.optional) {
      console.log(`  ${envVar.name}`);
      console.log(`    ${envVar.description}`);
    }
    console.log('');
  }

  output.heading('Next Steps:');
  for (const step of preset.nextSteps) {
    console.log(`  - ${step}`);
  }
}

/**
 * Parse preset type from string
 */
function parsePresetType(type: string): PresetType | null {
  const validTypes: PresetType[] = ['backend', 'subscriber', 'plugin', 'platform'];
  if (validTypes.includes(type as PresetType)) {
    return type as PresetType;
  }
  return null;
}

/**
 * Update instrumentation file with new preset
 */
export function addPresetToFile(
  content: string,
  preset: Preset
): string {
  // This is a simplified implementation
  // In a full implementation, we'd parse the file and insert at the right sections
  // For now, we'll add imports and config at the end of each section

  let result = content;

  // Add imports
  for (const imp of preset.imports) {
    const importLine = imp.sideEffect
      ? `import '${imp.source}';`
      : imp.default
        ? `import ${imp.default} from '${imp.source}';`
        : `import { ${imp.specifiers?.join(', ')} } from '${imp.source}';`;

    // Check if import already exists (match the full import statement pattern)
    const importPattern = imp.sideEffect
      ? `import '${imp.source}'`
      : imp.default
        ? `from '${imp.source}'`
        : `from '${imp.source}'`;
    if (!result.includes(importPattern)) {
      // Find the appropriate section marker and add after it
      const sectionMarker = preset.type === 'backend' || preset.type === 'platform' ? '// --- AUTOTEL:BACKEND ---' :
                            preset.type === 'plugin' ? '// --- AUTOTEL:PLUGINS ---' :
                            preset.type === 'subscriber' ? '// --- AUTOTEL:SUBSCRIBERS ---' : null;

      if (sectionMarker && result.includes(sectionMarker)) {
        result = result.replace(sectionMarker, `${sectionMarker}\n${importLine}`);
      } else {
        // Add at the end of imports section
        const initIndex = result.indexOf('init({');
        if (initIndex > 0) {
          result = result.slice(0, initIndex) + `${importLine}\n\n` + result.slice(initIndex);
        }
      }
    }
  }

  // Add config block
  const configCode = preset.configBlock.code;
  const configSection = preset.configBlock.section;

  if (configSection === 'BACKEND_CONFIG') {
    // Replace backend config section
    const backendMarker = '// --- AUTOTEL:BACKEND_CONFIG ---';
    if (result.includes(backendMarker)) {
      // Find the marker and the next line(s) until we hit another marker or closing brace
      const markerIndex = result.indexOf(backendMarker);
      const afterMarker = result.slice(markerIndex + backendMarker.length);

      // Find where the config ends (next marker, subscribers:, or closing });)
      const nextMarkerMatch = afterMarker.match(/\n\s*(\/\/ --- AUTOTEL:|subscribers:|}\);)/);
      const endIndex = nextMarkerMatch
        ? markerIndex + backendMarker.length + (nextMarkerMatch.index ?? 0)
        : markerIndex + backendMarker.length;

      result = result.slice(0, markerIndex) +
               backendMarker + '\n  ' + configCode + '\n' +
               result.slice(endIndex);
    } else {
      // Insert after init({ if no marker exists
      const initMatch = result.match(/init\(\{/);
      if (initMatch && initMatch.index !== undefined) {
        const insertPoint = initMatch.index + 'init({'.length;
        result = result.slice(0, insertPoint) +
                 '\n  ' + backendMarker + '\n  ' + configCode +
                 result.slice(insertPoint);
      }
    }
  } else if (configSection === 'SUBSCRIBERS_CONFIG') {
    // Find subscribers array and add
    const subscribersMatch = result.match(/subscribers:\s*\[([^\]]*)\]/s);
    if (subscribersMatch) {
      const existingSubscribers = subscribersMatch[1]?.trim();
      const newSubscribers = existingSubscribers
        ? `${existingSubscribers}\n    ${configCode}`
        : `\n    ${configCode}\n  `;
      result = result.replace(subscribersMatch[0], `subscribers: [${newSubscribers}]`);
    } else {
      // No subscribers array exists - create one
      // Find the closing }); of init() - it's the first }); after init({
      const subscribersMarker = '// --- AUTOTEL:SUBSCRIBERS_CONFIG ---';
      const initStart = result.indexOf('init({');
      if (initStart !== -1) {
        const afterInit = result.slice(initStart);
        const closingMatch = afterInit.match(/}\);/);
        if (closingMatch && closingMatch.index !== undefined) {
          const insertPoint = initStart + closingMatch.index;
          result = result.slice(0, insertPoint) +
                   '\n  ' + subscribersMarker + '\n  subscribers: [\n    ' +
                   configCode + '\n  ],\n' +
                   result.slice(insertPoint);
        }
      }
    }
  } else if (configSection === 'PLUGIN_INIT') {
    // Add at end before file ends
    const pluginMarker = '// --- AUTOTEL:PLUGIN_INIT ---';
    if (result.includes(pluginMarker)) {
      result = result.replace(pluginMarker, `${pluginMarker}\n${configCode}`);
    } else {
      result = result.trimEnd() + `\n\n${pluginMarker}\n${configCode}\n`;
    }
  }

  return result;
}

/**
 * Run the add command
 */
export async function runAdd(
  type: string | undefined,
  name: string | undefined,
  options: AddOptions
): Promise<void> {
  // Set output mode
  if (options.verbose) {
    process.env['AUTOTEL_VERBOSE'] = 'true';
  }
  if (options.quiet) {
    process.env['AUTOTEL_QUIET'] = 'true';
  }

  // List all presets
  if (options.list && !type) {
    output.heading('\nAvailable presets:\n');

    output.heading('Backends:');
    formatPresetList(getPresetsByType('backend'), options.json);

    output.heading('Subscribers:');
    formatPresetList(getPresetsByType('subscriber'), options.json);

    output.heading('Plugins:');
    formatPresetList(getPresetsByType('plugin'), options.json);

    output.heading('Platforms:');
    formatPresetList(getPresetsByType('platform'), options.json);

    return;
  }

  // Validate type
  if (!type) {
    output.error('Usage: autotel add <type> <name>');
    output.info('Types: backend, subscriber, plugin, platform');
    output.info('Run `autotel add --list` to see all presets');
    process.exit(1);
  }

  const presetType = parsePresetType(type);
  if (!presetType) {
    output.error(`Invalid type: ${type}`);
    output.info('Valid types: backend, subscriber, plugin, platform');
    process.exit(1);
  }

  // List presets for type
  if (options.list) {
    output.heading(`\n${presetType} presets:\n`);
    formatPresetList(getPresetsByType(presetType), options.json);
    return;
  }

  // Validate name
  if (!name) {
    output.error(`Usage: autotel add ${type} <name>`);
    output.info(`Available ${type}s: ${listPresetSlugs(presetType).join(', ')}`);
    process.exit(1);
  }

  // Get preset
  const preset = getPreset(presetType, name);
  if (!preset) {
    output.error(`Unknown ${type}: ${name}`);
    output.info(`Available ${type}s: ${listPresetSlugs(presetType).join(', ')}`);
    process.exit(1);
  }

  // Show help for preset
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showPresetHelp(preset);
    return;
  }

  const spinner = createSpinner();

  // Discover project
  spinner.start('Discovering project...');
  const project = discoverProject(options.cwd);

  if (!project) {
    spinner.fail('No package.json found');
    output.error('Run this command in a directory with a package.json, or use --cwd');
    process.exit(1);
  }

  spinner.succeed(`Found ${project.packageJson.name ?? 'project'}`);

  // Check if already installed
  const deps = { ...project.packageJson.dependencies, ...project.packageJson.devDependencies };
  const allInstalled = preset.packages.required.every((pkg) => deps[pkg]);

  // Check if already configured
  const config = detectConfig(project.packageRoot);
  let alreadyConfigured = false;

  if (config.instrumentationFile) {
    alreadyConfigured = isFeatureConfigured(config.instrumentationFile, presetType);
  }

  // Idempotency check
  if (allInstalled && alreadyConfigured) {
    output.success(`[OK] ${preset.name} is already installed and configured`);
    return;
  }

  if (allInstalled) {
    output.info(`Packages already installed`);
  }

  if (alreadyConfigured) {
    output.info(`Already configured in instrumentation file`);
  }

  // Dry run
  if (options.dryRun) {
    output.heading('\nDry run - no changes will be made\n');

    if (!allInstalled) {
      const cmd = getInstallCommand(project.packageManager, preset.packages.required);
      output.info(`Would run: ${cmd}`);
    }

    if (!alreadyConfigured) {
      output.info(`Would update instrumentation file with ${preset.name} config`);
    }

    return;
  }

  // Install packages
  if (!allInstalled && !options.noInstall) {
    const missingPkgs = preset.packages.required.filter((pkg) => !deps[pkg]);
    const cmd = getInstallCommand(project.packageManager, missingPkgs);

    if (options.printInstallCmd) {
      output.info(`Install command: ${cmd}`);
    } else {
      spinner.start('Installing packages...');
      try {
        execSync(cmd, { cwd: project.packageRoot, stdio: 'pipe' });
        spinner.succeed('Packages installed');
      } catch {
        spinner.fail('Failed to install packages');
        output.error(`Run manually: ${cmd}`);
      }
    }
  }

  // Update instrumentation file
  if (!alreadyConfigured) {
    if (!config.found || config.type === 'none') {
      output.warn('No instrumentation file found');
      output.info('Run `autotel init` first to create one');
      process.exit(1);
    }

    if (config.type === 'user-created' && !options.force) {
      output.warn('Instrumentation file exists but is not CLI-owned');
      output.info('Use --force to modify, or add CLI header to the file');
      process.exit(1);
    }

    const instrPath = config.path!;
    const content = readFileSafe(instrPath);

    if (content) {
      spinner.start('Updating instrumentation file...');
      const updatedContent = addPresetToFile(content, preset);
      atomicWrite(instrPath, updatedContent, {
        root: project.packageRoot,
        backup: options.force,
      });
      spinner.succeed('Instrumentation file updated');
    }
  }

  // Print next steps
  console.log(output.formatFooter({
    detected: `${project.packageManager}`,
    next: preset.nextSteps[0],
  }));

  if (preset.nextSteps.length > 1) {
    console.log('\nAdditional steps:');
    for (const step of preset.nextSteps.slice(1)) {
      console.log(`  - ${step}`);
    }
  }
}
