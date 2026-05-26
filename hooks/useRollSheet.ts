"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createRollOrchestrator } from "@/lib/roll-orchestrator";
import type { OrchestratorPhase, OrchestratorSnapshot } from "@/lib/roll-orchestrator";
import { RollGate } from "@/lib/roll-gate";
import { completeTurn } from "@/app/actions/complete-turn";
import type { ActiveRollContext } from "@/lib/roll-context";
import type { TurnResult } from "@/app/actions/take-turn";

export type { OrchestratorPhase };

export interface UseRollSheetReturn extends OrchestratorSnapshot {
  triggerRoll: () => void;
}

/**
 * Bridges the server-seeded d20 response with a fixed visual timeline.
 *
 * Timing contract:
 *   - Die spins for a minimum of MIN_SPIN_MS (1200ms) from the first tap.
 *   - If the server responds faster (e.g. 150ms), the extra hold preserves
 *     dramatic tension. If slower, the reveal fires immediately on receipt.
 *   - At reveal: completeTurn() fires to append the story node.
 *   - POST_REVEAL_MS (1500ms) later: sheet begins sliding out.
 *   - SLIDE_OUT_MS (320ms) later: onDone() is called to clear context.
 *
 * The RollGate ref blocks all subsequent taps synchronously — no double-fire
 * is possible even if the user taps many times during the network round-trip.
 */
export function useRollSheet(
  activeRollContext: ActiveRollContext | null,
  gameId:            string,
  chipText:          string,
  onTurnComplete:    (result: TurnResult) => void,
  onDone:            () => void,
): UseRollSheetReturn {
  const orchestrator  = useRef(createRollOrchestrator());
  const gate          = useRef(new RollGate());
  const onCompleteRef = useRef(onTurnComplete);
  const onDoneRef     = useRef(onDone);
  onCompleteRef.current = onTurnComplete;
  onDoneRef.current     = onDone;

  const [snapshot, setSnapshot] = useState<OrchestratorSnapshot>(
    orchestrator.current.snapshot,
  );

  useEffect(() => {
    return orchestrator.current.subscribe((snap) => {
      setSnapshot(snap);

      if (snap.phase === "revealing" && snap.revealedD20 !== null && activeRollContext) {
        // Fire narrative completion concurrently with the reveal render.
        completeTurn(gameId, chipText, activeRollContext.rollRequestId)
          .then((result) => onCompleteRef.current(result))
          .catch(() => {/* surface errors via onTurnComplete path in parent */});
      }

      if (snap.phase === "done") {
        gate.current.release();
        onDoneRef.current();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerRoll = useCallback(() => {
    if (!activeRollContext || !gate.current.tryAcquire()) return;
    orchestrator.current.start();

    fetch("/api/rolls/secure-seed", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        rollRequestId: activeRollContext.rollRequestId,
        gameId,
      }),
    })
      .then((r) => r.json())
      .then(({ d20 }: { d20: number }) => {
        orchestrator.current.receiveResult(d20);
      })
      .catch(() => {
        gate.current.release();
        orchestrator.current.reset();
      });
  }, [activeRollContext, gameId]);

  return { ...snapshot, triggerRoll };
}
