import { describe, it, expect } from 'vitest';
import { catalog } from './catalog';

describe('AI catalog', () => {
  it('exports a catalog with component definitions', () => {
    expect(catalog).toBeDefined();
    expect(typeof catalog.prompt).toBe('function');
  });

  it('generates a system prompt describing available components', () => {
    const prompt = catalog.prompt({
      system: 'You are a test assistant',
    });
    expect(prompt).toContain('Table');
    expect(prompt).toContain('Badge');
    expect(prompt).toContain('BarChart');
  });
});
