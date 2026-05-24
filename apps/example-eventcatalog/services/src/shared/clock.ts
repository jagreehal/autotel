// Injectable clock for event timestamps. Default is wall-clock; tests and
// the snapshot script swap in a deterministic counter so committed snapshots
// stay byte-stable across runs (the architecture is what we care about; the
// exact moment a sample value was observed is not).

let isoClock: () => string = () => new Date().toISOString();

export function setIsoClock(fn: () => string): void {
  isoClock = fn;
}

export function isoNow(): string {
  return isoClock();
}
