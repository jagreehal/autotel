import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getInstrumentationPath } from './project.js';

describe('project helpers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-project-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should prefer src/ for instrumentation when src directory exists', () => {
    fs.mkdirSync(path.join(tempDir, 'src'));

    const instrumentationPath = getInstrumentationPath(tempDir, false);

    expect(instrumentationPath).toBe(
      path.join(tempDir, 'src', 'instrumentation.mjs')
    );
  });
});
