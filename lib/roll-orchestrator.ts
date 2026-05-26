export type OrchestratorPhase =
  | "idle"        // waiting for the player to tap
  | "spinning"    // die animating; server result may be in flight
  | "revealing"   // ≥MIN_SPIN_MS elapsed, d20 value visible
  | "dismounting" // POST_REVEAL_MS elapsed, sheet sliding out
  | "done";       // slide animation finished, context should be cleared

export interface OrchestratorSnapshot {
  phase:       OrchestratorPhase;
  revealedD20: number | null;
}

type Listener = (snap: OrchestratorSnapshot) => void;

// Exported so tests can share the same constants.
export const MIN_SPIN_MS    = 1200;
export const POST_REVEAL_MS = 1500;
export const SLIDE_OUT_MS   = 320; // matches CSS transition duration

/**
 * Pure timing state machine for the Server-Seeded Roll reveal sequence.
 * No React, no DOM — fully testable with vitest fake timers.
 *
 * Lifecycle:
 *   start()         → "spinning"
 *   receiveResult() → waits until MIN_SPIN_MS elapsed from start(), then → "revealing"
 *   (auto)          → "dismounting" after POST_REVEAL_MS
 *   (auto)          → "done" after SLIDE_OUT_MS
 *
 * The guarantee: revealedD20 is null until the reveal fires regardless of
 * how fast the server returns the seed — the UI can never show math before
 * the animation timer concludes.
 */
export function createRollOrchestrator() {
  let phase:      OrchestratorPhase = "idle";
  let revealedD20: number | null    = null;
  let spinStart:   number | null    = null;
  let pendingD20:  number | null    = null;

  let revealTimer:   ReturnType<typeof setTimeout> | null = null;
  let dismountTimer: ReturnType<typeof setTimeout> | null = null;
  let doneTimer:     ReturnType<typeof setTimeout> | null = null;

  const listeners = new Set<Listener>();

  function snapshot(): OrchestratorSnapshot {
    return { phase, revealedD20 };
  }

  function emit() {
    const s = snapshot();
    listeners.forEach((l) => l(s));
  }

  function clearAllTimers() {
    if (revealTimer)   { clearTimeout(revealTimer);   revealTimer   = null; }
    if (dismountTimer) { clearTimeout(dismountTimer); dismountTimer = null; }
    if (doneTimer)     { clearTimeout(doneTimer);     doneTimer     = null; }
  }

  function arm() {
    if (pendingD20 === null || spinStart === null) return;
    const elapsed = Date.now() - spinStart;
    const holdFor = Math.max(0, MIN_SPIN_MS - elapsed);

    revealTimer = setTimeout(() => {
      revealedD20 = pendingD20;
      phase       = "revealing";
      emit();

      dismountTimer = setTimeout(() => {
        phase = "dismounting";
        emit();

        doneTimer = setTimeout(() => {
          phase = "done";
          emit();
        }, SLIDE_OUT_MS);
      }, POST_REVEAL_MS);
    }, holdFor);
  }

  return {
    start(): void {
      clearAllTimers();
      phase       = "spinning";
      revealedD20 = null;
      pendingD20  = null;
      spinStart   = Date.now();
      emit();
    },

    receiveResult(d20: number): void {
      pendingD20 = d20;
      arm();
    },

    reset(): void {
      clearAllTimers();
      phase       = "idle";
      revealedD20 = null;
      pendingD20  = null;
      spinStart   = null;
      emit();
    },

    subscribe(l: Listener): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },

    get snapshot(): OrchestratorSnapshot {
      return snapshot();
    },
  };
}
