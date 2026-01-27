import { describe, it, expect } from 'vitest';
import {
  createCodeFile,
  addImport,
  setBackendConfig,
  addSubscriberConfig,
  addPluginInit,
  renderCodeFile,
  hasCliOwnershipHeader,
  hasSectionMarker,
  getSectionMarkers,
  buildMinimalInstrumentation,
} from './code-builder.js';

describe('code-builder', () => {
  describe('createCodeFile', () => {
    it('should create empty code file', () => {
      const file = createCodeFile();
      expect(file.imports).toEqual([]);
      expect(file.backendImports).toEqual([]);
      expect(file.pluginImports).toEqual([]);
      expect(file.subscriberImports).toEqual([]);
      expect(file.backendConfig).toBeNull();
      expect(file.subscribersConfig).toEqual([]);
      expect(file.pluginInit).toEqual([]);
    });
  });

  describe('addImport', () => {
    it('should add import to main imports', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      expect(file.imports).toHaveLength(1);
      expect(file.imports[0]?.source).toBe('autotel');
    });

    it('should add import to backend section', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel-backends/datadog', specifiers: ['createDatadogConfig'] }, 'backend');
      expect(file.backendImports).toHaveLength(1);
      expect(file.imports).toHaveLength(0);
    });

    it('should add import to plugin section', () => {
      const file = createCodeFile();
      addImport(file, { source: 'mongoose', default: 'mongoose' }, 'plugin');
      expect(file.pluginImports).toHaveLength(1);
    });

    it('should add import to subscriber section', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel-subscribers/posthog', specifiers: ['PostHogSubscriber'] }, 'subscriber');
      expect(file.subscriberImports).toHaveLength(1);
    });
  });

  describe('renderCodeFile', () => {
    it('should render minimal file with header', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel/register', sideEffect: true });
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      setBackendConfig(file, '// Local mode');

      const output = renderCodeFile(file);

      expect(output).toContain('autotel instrumentation - managed by autotel-cli');
      expect(output).toContain("import 'autotel/register';");
      expect(output).toContain("import { init } from 'autotel';");
      expect(output).toContain('init({');
      expect(output).toContain('// Local mode');
      expect(output.endsWith('\n')).toBe(true);
    });

    it('should place side-effect imports first', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      addImport(file, { source: 'autotel/register', sideEffect: true });

      const output = renderCodeFile(file);
      const registerIndex = output.indexOf("import 'autotel/register';");
      const initIndex = output.indexOf("import { init } from 'autotel';");

      expect(registerIndex).toBeLessThan(initIndex);
    });

    it('should include section markers', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel/register', sideEffect: true });
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      addImport(file, { source: 'autotel-backends/datadog', specifiers: ['createDatadogConfig'] }, 'backend');
      setBackendConfig(file, '...createDatadogConfig({})');

      const output = renderCodeFile(file);

      expect(output).toContain('// --- AUTOTEL:BACKEND ---');
      expect(output).toContain('// --- AUTOTEL:BACKEND_CONFIG ---');
    });

    it('should render subscribers config array', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel/register', sideEffect: true });
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      addImport(file, { source: 'autotel-subscribers/posthog', specifiers: ['PostHogSubscriber'] }, 'subscriber');
      addSubscriberConfig(file, 'new PostHogSubscriber({}),');

      const output = renderCodeFile(file);

      expect(output).toContain('// --- AUTOTEL:SUBSCRIBERS ---');
      expect(output).toContain('// --- AUTOTEL:SUBSCRIBERS_CONFIG ---');
      expect(output).toContain('subscribers: [');
      expect(output).toContain('new PostHogSubscriber({})');
    });

    it('should render plugin init section', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel/register', sideEffect: true });
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      addImport(file, { source: 'autotel-plugins/mongoose', specifiers: ['instrumentMongoose'] }, 'plugin');
      addImport(file, { source: 'mongoose', default: 'mongoose' }, 'plugin');
      addPluginInit(file, 'instrumentMongoose(mongoose);');

      const output = renderCodeFile(file);

      expect(output).toContain('// --- AUTOTEL:PLUGINS ---');
      expect(output).toContain('// --- AUTOTEL:PLUGIN_INIT ---');
      expect(output).toContain('instrumentMongoose(mongoose);');
    });
  });

  describe('hasCliOwnershipHeader', () => {
    it('should return true for CLI-owned content', () => {
      const content = `/**
 * autotel instrumentation - managed by autotel-cli
 * Run \`autotel add <feature>\` to update this file
 */
import 'autotel/register';`;

      expect(hasCliOwnershipHeader(content)).toBe(true);
    });

    it('should return false for user-created content', () => {
      const content = `// My custom instrumentation
import 'autotel/register';`;

      expect(hasCliOwnershipHeader(content)).toBe(false);
    });
  });

  describe('hasSectionMarker', () => {
    it('should detect BACKEND section', () => {
      const content = `// --- AUTOTEL:BACKEND ---
import { createDatadogConfig } from 'autotel-backends/datadog';`;

      expect(hasSectionMarker(content, 'BACKEND')).toBe(true);
    });

    it('should not match partial markers', () => {
      const content = `// AUTOTEL:BACKEND
import something;`;

      expect(hasSectionMarker(content, 'BACKEND')).toBe(false);
    });
  });

  describe('getSectionMarkers', () => {
    it('should extract all section markers', () => {
      const content = `/**
 * autotel instrumentation - managed by autotel-cli
 */
import 'autotel/register';

// --- AUTOTEL:BACKEND ---
import { createDatadogConfig } from 'autotel-backends/datadog';

// --- AUTOTEL:PLUGINS ---
import { instrumentMongoose } from 'autotel-plugins/mongoose';

init({
  // --- AUTOTEL:BACKEND_CONFIG ---
  ...createDatadogConfig({}),
});

// --- AUTOTEL:PLUGIN_INIT ---
instrumentMongoose(mongoose);`;

      const markers = getSectionMarkers(content);

      expect(markers).toContain('BACKEND');
      expect(markers).toContain('PLUGINS');
      expect(markers).toContain('BACKEND_CONFIG');
      expect(markers).toContain('PLUGIN_INIT');
      expect(markers).toHaveLength(4);
    });
  });

  describe('buildMinimalInstrumentation', () => {
    it('should produce valid minimal file', () => {
      const output = buildMinimalInstrumentation();

      expect(output).toContain('autotel instrumentation - managed by autotel-cli');
      expect(output).toContain("import 'autotel/register';");
      expect(output).toContain("import { init } from 'autotel';");
      expect(output).toContain('init({');
      expect(output).toContain('// Local/console mode');
    });
  });

  describe('golden output snapshots', () => {
    it('should match snapshot for datadog backend', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel/register', sideEffect: true });
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      addImport(file, { source: 'autotel-backends/datadog', specifiers: ['createDatadogConfig'] }, 'backend');
      setBackendConfig(file, `...createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY,
    site: process.env.DATADOG_SITE,
  }),`);

      const output = renderCodeFile(file);

      // Verify structure without exact snapshot
      expect(output).toContain('autotel instrumentation - managed by autotel-cli');
      expect(output).toContain("import 'autotel/register';");
      expect(output).toContain("import { init } from 'autotel';");
      expect(output).toContain('// --- AUTOTEL:BACKEND ---');
      expect(output).toContain("import { createDatadogConfig } from 'autotel-backends/datadog';");
      expect(output).toContain('// --- AUTOTEL:BACKEND_CONFIG ---');
      expect(output).toContain('createDatadogConfig');
      expect(output).toContain('DATADOG_API_KEY');
    });

    it('should match snapshot for honeycomb + posthog', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel/register', sideEffect: true });
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      addImport(file, { source: 'autotel-backends/honeycomb', specifiers: ['createHoneycombConfig'] }, 'backend');
      addImport(file, { source: 'autotel-subscribers/posthog', specifiers: ['PostHogSubscriber'] }, 'subscriber');
      setBackendConfig(file, `...createHoneycombConfig({
    apiKey: process.env.HONEYCOMB_API_KEY,
  }),`);
      addSubscriberConfig(file, `new PostHogSubscriber({
      apiKey: process.env.POSTHOG_API_KEY,
    }),`);

      const output = renderCodeFile(file);

      expect(output).toContain('// --- AUTOTEL:BACKEND ---');
      expect(output).toContain('createHoneycombConfig');
      expect(output).toContain('// --- AUTOTEL:SUBSCRIBERS ---');
      expect(output).toContain('PostHogSubscriber');
      expect(output).toContain('subscribers: [');
    });

    it('should match snapshot for mongoose plugin', () => {
      const file = createCodeFile();
      addImport(file, { source: 'autotel/register', sideEffect: true });
      addImport(file, { source: 'autotel', specifiers: ['init'] });
      addImport(file, { source: 'autotel-plugins/mongoose', specifiers: ['instrumentMongoose'] }, 'plugin');
      addImport(file, { source: 'mongoose', default: 'mongoose' }, 'plugin');
      setBackendConfig(file, '// Local mode');
      addPluginInit(file, 'instrumentMongoose(mongoose);');

      const output = renderCodeFile(file);

      expect(output).toContain('// --- AUTOTEL:PLUGINS ---');
      expect(output).toContain("import { instrumentMongoose } from 'autotel-plugins/mongoose';");
      expect(output).toContain("import mongoose from 'mongoose';");
      expect(output).toContain('// --- AUTOTEL:PLUGIN_INIT ---');
      expect(output).toContain('instrumentMongoose(mongoose);');
    });
  });
});
