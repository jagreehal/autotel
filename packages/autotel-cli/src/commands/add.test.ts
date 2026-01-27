import { describe, it, expect } from 'vitest';
import {
  buildMinimalInstrumentation,
  createCodeFile,
  addImport,
  addPluginInit,
  renderCodeFile,
  setBackendConfig,
} from '../lib/code-builder.js';
import { addPresetToFile } from './add.js';
import { datadogDirect } from '../presets/backends/datadog.js';
import { posthogSubscriber } from '../presets/subscribers/posthog.js';

describe('addPresetToFile', () => {
  it('should add backend config block for backend presets', () => {
    const content = buildMinimalInstrumentation();

    const updated = addPresetToFile(content, datadogDirect);

    expect(updated).toContain('createDatadogConfig');
    expect(updated).toContain('DATADOG_API_KEY');
  });

  it('should add subscribers config when adding a subscriber preset', () => {
    const content = buildMinimalInstrumentation();

    const updated = addPresetToFile(content, posthogSubscriber);

    expect(updated).toContain('subscribers: [');
    expect(updated).toContain('PostHogSubscriber');
  });

  it('should add subscribers config even when plugin init exists', () => {
    const file = createCodeFile();
    addImport(file, { source: 'autotel/register', sideEffect: true });
    addImport(file, { source: 'autotel', specifiers: ['init'] });
    setBackendConfig(file, '// Local/console mode - no backend configured');
    addPluginInit(file, 'console.log("plugin init");');

    const content = renderCodeFile(file);
    const updated = addPresetToFile(content, posthogSubscriber);

    expect(updated).toContain('subscribers: [');
    expect(updated).toContain('PostHogSubscriber');
  });
});
