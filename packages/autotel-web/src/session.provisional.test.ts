// @vitest-environment jsdom
/**
 * While the owning join's SDK starts, autotel mints a stand-in session id.
 * Two things must hold across the moment the vendor's session arrives:
 * records are filed under the session that was current then, permanently;
 * and the visit keeps one sampling decision, because a record dropped under
 * one key cannot be re-stamped back under the other.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSessionAttributes,
  resetSessionForTesting,
  samplingKeyFor,
  setJoinSessionProvider,
  settledSessionId,
} from './session';
import { sampleByKey } from './sampling';

/** A recorder's session, absent until the test starts it. */
function vendorSession() {
  let id: string | undefined;
  return {
    read: () => id,
    start: (value: string) => {
      id = value;
    },
  };
}

afterEach(() => resetSessionForTesting());

function standIn(): string {
  const id = getSessionAttributes()?.['session.id'];
  if (!id) throw new Error('no session');
  return id;
}

describe('provisional session ids', () => {
  it('stay filed under the session current when the vendor arrived', () => {
    let vendor: string | undefined;
    setJoinSessionProvider(() => vendor);
    const early = standIn();

    vendor = 'session-A';
    expect(getSessionAttributes()?.['session.id']).toBe('session-A');
    // The vendor rotates before the queued record is sent or retried.
    vendor = 'session-B';
    expect(settledSessionId(early)).toBe('session-A');
  });

  it('keep the first answer when resolved lazily, too', () => {
    let vendor: string | undefined;
    setJoinSessionProvider(() => vendor);
    const early = standIn();

    vendor = 'session-A';
    expect(settledSessionId(early)).toBe('session-A');
    vendor = 'session-B';
    expect(settledSessionId(early)).toBe('session-A');
  });

  it('sample the vendor session as the visit that began before it', () => {
    const vendor = vendorSession();
    setJoinSessionProvider(vendor.read);
    const early = standIn();

    // A vendor id that, hashed on its own, gets the other decision.
    const rate = 0.5;
    let candidate = 0;
    while (
      sampleByKey(`vendor-${candidate}`, rate) === sampleByKey(early, rate)
    ) {
      candidate += 1;
    }
    vendor.start(`vendor-${candidate}`);
    getSessionAttributes();

    expect(samplingKeyFor(`vendor-${candidate}`)).toBe(early);
    expect(sampleByKey(samplingKeyFor(`vendor-${candidate}`), rate)).toBe(
      sampleByKey(early, rate),
    );
  });

  it('give a rotated session a decision of its own', () => {
    let vendor: string | undefined;
    setJoinSessionProvider(() => vendor);
    const early = standIn();
    vendor = 'session-A';
    getSessionAttributes();
    vendor = 'session-B';
    getSessionAttributes();

    expect(samplingKeyFor('session-A')).toBe(early);
    expect(samplingKeyFor('session-B')).toBe('session-B');
  });
});
