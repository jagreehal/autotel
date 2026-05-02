import { describe, it, expect } from 'vitest';

describe('cloudflare entry point', () => {
  it('should re-export all workers module content', async () => {
    const cloudflare = await import('./cloudflare');
    const workers = await import('./workers');

    // Verify cloudflare is an alias for workers
    expect(cloudflare.init).toBe(workers.init);
    expect(cloudflare.trace).toBe(workers.trace);
    expect(cloudflare.span).toBe(workers.span);
    expect(cloudflare.wrapModule).toBe(workers.wrapModule);
    expect(cloudflare.getRequestLogger).toBe(workers.getRequestLogger);
  });

  it('should provide an alternative import path for Cloudflare-specific APIs', async () => {
    const cloudflare = await import('./cloudflare');

    // Verify key Cloudflare-specific exports are available
    expect(cloudflare.instrument).toBeDefined();
    expect(cloudflare.instrumentDO).toBeDefined();
    expect(cloudflare.instrumentKV).toBeDefined();
    expect(cloudflare.instrumentWorkflow).toBeDefined();
  });
});
