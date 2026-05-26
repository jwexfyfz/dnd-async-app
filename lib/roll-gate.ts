/**
 * Single-use mutual exclusion gate for the Server-Seeded Roll tap handler.
 * tryAcquire() atomically checks-and-sets the lock in a single JS microtask;
 * synchronous JS is single-threaded so no real atomics are needed.
 */
export class RollGate {
  private _locked = false;

  /** Returns true and locks if currently unlocked; returns false if already locked. */
  tryAcquire(): boolean {
    if (this._locked) return false;
    this._locked = true;
    return true;
  }

  release(): void {
    this._locked = false;
  }

  get isLocked(): boolean {
    return this._locked;
  }
}
