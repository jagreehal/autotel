// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveCaptureToggles } from './remote-config';

describe('remote capture toggles', () => {
  it('turns a signal on that the app left off', () => {
    // The documented point of remote config: change what is captured without a
    // release. A toggle that can only ever say "off" is not a control.
    expect(
      resolveCaptureToggles(
        { frustration: false, engagement: false },
        { captureDeadClicks: true, captureEngagement: true },
      ),
    ).toEqual({ frustration: true, engagement: true, deadClicks: true, rage: undefined });
  });

  it('turns a signal off that the app left on', () => {
    expect(
      resolveCaptureToggles(
        { frustration: true, engagement: true },
        { captureDeadClicks: false, captureRageClicks: false, captureEngagement: false },
      ),
    ).toEqual({ frustration: false, engagement: false, deadClicks: false, rage: false });
  });

  it('enables frustration when only one half is asked for', () => {
    const resolved = resolveCaptureToggles(
      { frustration: false, engagement: false },
      { captureRageClicks: true },
    );
    expect(resolved.frustration).toBe(true);
    expect(resolved.rage).toBe(true);
    expect(resolved.deadClicks).toBeUndefined();
  });

  it('leaves local config alone when there is no remote config', () => {
    expect(
      resolveCaptureToggles({ frustration: true, engagement: false }, undefined),
    ).toEqual({
      frustration: true,
      engagement: false,
      deadClicks: undefined,
      rage: undefined,
    });
  });

  it('keeps frustration off when remote turns both halves off', () => {
    const resolved = resolveCaptureToggles(
      { frustration: true, engagement: false },
      { captureDeadClicks: false, captureRageClicks: false },
    );
    expect(resolved.frustration).toBe(false);
  });
});
