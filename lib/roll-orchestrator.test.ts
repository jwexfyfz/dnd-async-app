// Integration tests — async sequencing of the Server-Seeded Roll reveal.
//
// Core invariant under test: the frontend UI never exposes the d20 value
// (revealedD20) before MIN_SPIN_MS has elapsed since start(), regardless of
// how quickly the server returns the seed. Tests use vitest fake timers so
// the full 1200+1500+320 ms timeline runs in microseconds.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRollOrchestrator,
  MIN_SPIN_MS,
  POST_REVEAL_MS,
  SLIDE_OUT_MS,
} from "./roll-orchestrator";

describe("RollOrchestrator — async sequencing", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it("holds the reveal when the server responds faster than MIN_SPIN_MS", async () => {
    const o = createRollOrchestrator();
    o.start();

    // Fast server: seed arrives at 150 ms
    await vi.advanceTimersByTimeAsync(150);
    o.receiveResult(14);

    // At 600 ms — still spinning, math must not be visible
    await vi.advanceTimersByTimeAsync(450);
    expect(o.snapshot.phase).toBe("spinning");
    expect(o.snapshot.revealedD20).toBeNull(); // invariant: no early reveal

    // Exactly at MIN_SPIN_MS — reveal fires
    await vi.advanceTimersByTimeAsync(MIN_SPIN_MS - 600);
    expect(o.snapshot.phase).toBe("revealing");
    expect(o.snapshot.revealedD20).toBe(14);
  });

  it("reveals immediately when the server is slower than MIN_SPIN_MS", async () => {
    const o = createRollOrchestrator();
    o.start();

    // Slow server: responds at 2000 ms (well past the 1200 ms threshold)
    await vi.advanceTimersByTimeAsync(2_000);
    o.receiveResult(7);

    await vi.advanceTimersByTimeAsync(0); // flush the 0-delay timer
    expect(o.snapshot.phase).toBe("revealing");
    expect(o.snapshot.revealedD20).toBe(7);
  });

  it("transitions to dismounting exactly POST_REVEAL_MS after reveal", async () => {
    const o = createRollOrchestrator();
    o.start();
    o.receiveResult(20);

    await vi.advanceTimersByTimeAsync(MIN_SPIN_MS);
    expect(o.snapshot.phase).toBe("revealing");

    await vi.advanceTimersByTimeAsync(POST_REVEAL_MS - 1);
    expect(o.snapshot.phase).toBe("revealing"); // not yet

    await vi.advanceTimersByTimeAsync(1);
    expect(o.snapshot.phase).toBe("dismounting");
  });

  it("reaches done after the full slide-out duration", async () => {
    const o = createRollOrchestrator();
    o.start();
    o.receiveResult(3);

    await vi.advanceTimersByTimeAsync(MIN_SPIN_MS + POST_REVEAL_MS + SLIDE_OUT_MS);
    expect(o.snapshot.phase).toBe("done");
    expect(o.snapshot.revealedD20).toBe(3);
  });

  it("reset() cancels all pending timers and returns to idle", async () => {
    const o = createRollOrchestrator();
    o.start();
    o.receiveResult(11);

    await vi.advanceTimersByTimeAsync(600); // mid-spin
    o.reset();

    // Advance past what would have been the reveal — must stay idle
    await vi.advanceTimersByTimeAsync(MIN_SPIN_MS + POST_REVEAL_MS + SLIDE_OUT_MS);
    expect(o.snapshot.phase).toBe("idle");
    expect(o.snapshot.revealedD20).toBeNull();
  });

  it("emits each phase transition to all subscribers in order", async () => {
    const o = createRollOrchestrator();
    const phases: string[] = [];
    o.subscribe((s) => phases.push(s.phase));

    o.start();
    o.receiveResult(17);
    await vi.advanceTimersByTimeAsync(MIN_SPIN_MS + POST_REVEAL_MS + SLIDE_OUT_MS);

    expect(phases).toEqual(["spinning", "revealing", "dismounting", "done"]);
  });
});
