import { describe, expect, it } from 'vitest';
import {
  describeDownload,
  describeRefusal,
  describeSamplingOption,
  guardWouldRefuse,
} from './describe';

describe('describeSamplingOption', () => {
  it('reports no options as none', () => {
    expect(describeSamplingOption(undefined)).toBe('none');
    expect(describeSamplingOption({})).toBe('none');
    expect(describeSamplingOption({ outputLanguage: 'en' })).toBe('none');
  });

  it('names each sampling knob', () => {
    expect(describeSamplingOption({ samplingMode: 'most-predictable' })).toBe(
      'samplingMode',
    );
    expect(describeSamplingOption({ topK: 1 })).toBe('topK');
    expect(describeSamplingOption({ temperature: 0.7 })).toBe('temperature');
    expect(describeSamplingOption({ topK: 1, temperature: 0 })).toBe(
      'topK+temperature',
    );
  });

  // The two values a caller is most likely to pass are both falsy, and both
  // are the whole point of the attribute.
  it('counts temperature 0 and topK 0 as supplied', () => {
    expect(describeSamplingOption({ temperature: 0 })).toBe('temperature');
    expect(describeSamplingOption({ topK: 0 })).toBe('topK');
  });

  it('prefers samplingMode when it is combined with the raw knobs', () => {
    expect(
      describeSamplingOption({ samplingMode: 'most-predictable', topK: 1 }),
    ).toBe('samplingMode');
  });

  it('ignores a non-finite knob', () => {
    expect(describeSamplingOption({ temperature: Number.NaN })).toBe('none');
  });
});

describe('describeRefusal', () => {
  it('classifies the speculative decoding refusal', () => {
    expect(
      describeRefusal(
        'The sampling options are incompatible with speculative decoding (MTP). ' +
          "Prompt API sessions must specify compatible sampling options, i.e. `samplingMode:'most-predictable'`",
      ),
    ).toBe('sampling_incompatible');
  });

  it('classifies an unprovisioned model', () => {
    expect(
      describeRefusal(
        'Unable to create a text session because the service is not running.',
      ),
    ).toBe('service_unavailable');
  });

  it('leaves anything else unclassified', () => {
    expect(describeRefusal('The operation was aborted.')).toBeUndefined();
    expect(describeRefusal('')).toBeUndefined();
  });
});

describe('describeDownload', () => {
  it('records nothing when the monitor never fired', () => {
    expect(describeDownload('available', [])).toEqual({
      events: 0,
      lastLoaded: undefined,
      observed: false,
      real: false,
    });
  });

  // Measured: create() on a browser that already has the model emits two
  // events ending at 1 within milliseconds. Reading that as a download is the
  // mistake this exists to stop.
  it('does not call a no-op download real', () => {
    const facts = describeDownload('available', [0, 1]);
    expect(facts.observed).toBe(true);
    expect(facts.real).toBe(false);
    expect(facts.events).toBe(2);
    expect(facts.lastLoaded).toBe(1);
  });

  it('calls it real when the model was downloadable beforehand', () => {
    expect(describeDownload('downloadable', [0.5, 1]).real).toBe(true);
    expect(describeDownload('downloading', [0.5]).real).toBe(true);
  });

  it('is undecided when nothing is known about the state before', () => {
    expect(describeDownload(undefined, [0, 1]).real).toBe(false);
  });
});

describe('guardWouldRefuse', () => {
  // The exact combination measured on Canary 154 with a working model.
  it('catches a bare guard refusing a working browser', () => {
    expect(guardWouldRefuse('unavailable', 'available')).toBe(true);
  });

  it('stays quiet when the two agree', () => {
    expect(guardWouldRefuse('available', 'available')).toBe(false);
    expect(guardWouldRefuse('unavailable', 'unavailable')).toBe(false);
  });

  it('stays quiet when the options did not rescue it', () => {
    expect(guardWouldRefuse('unavailable', 'downloadable')).toBe(false);
  });
});
