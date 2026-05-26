"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { resolveRoll } from "@/app/actions/resolve-roll";
import { autoAdvance, type AutoAdvanceResult } from "@/app/actions/auto-advance";
import type { QueueRoll } from "@/types/suggestion-chip";

// Possible phases the sheet can be in during a turn.
// "rolling"        — waiting for the player to tap Roll
// "resolving"      — resolveRoll network call in flight
// "auto-advancing" — all rolls done, Claude call in flight
// "sliding"        — 1.5s post-advance pause before slide-out
export type TurnQueuePhase = "rolling" | "resolving" | "auto-advancing" | "sliding";

export interface UseTurnQueueReturn {
  phase:            TurnQueuePhase;
  rolls:            QueueRoll[];
  currentRollIndex: number;
  error:            string | null;
  rollCurrent:      () => void;
}

export function useTurnQueue(
  gameId:            string,
  turnId:            string,
  initialRolls:      QueueRoll[],
  chipLabel:         string,
  onAdvanceComplete: (result: AutoAdvanceResult) => void,
  onDone:            () => void,
): UseTurnQueueReturn {
  const noRolls = initialRolls.length === 0;

  const [phase,            setPhase]            = useState<TurnQueuePhase>(noRolls ? "auto-advancing" : "rolling");
  const [rolls,            setRolls]            = useState<QueueRoll[]>(initialRolls);
  const [currentRollIndex, setCurrentRollIndex] = useState(0);
  const [error,            setError]            = useState<string | null>(null);

  const isLocked      = useRef(false);
  const advanceFired  = useRef(false);
  const onAdvanceRef  = useRef(onAdvanceComplete);
  const onDoneRef     = useRef(onDone);
  onAdvanceRef.current = onAdvanceComplete;
  onDoneRef.current    = onDone;

  const fireAutoAdvance = useCallback(async () => {
    if (advanceFired.current) return;
    advanceFired.current = true;
    setPhase("auto-advancing");

    const result = await autoAdvance(gameId, turnId, chipLabel);
    if (result.success) {
      onAdvanceRef.current(result);
    } else {
      setError(result.error ?? "Auto-advance failed.");
    }

    setPhase("sliding");
    setTimeout(() => {
      onDoneRef.current();
    }, 1500);
  }, [gameId, turnId, chipLabel]);

  // Free-action chips (no rolls) auto-advance immediately on mount.
  useEffect(() => {
    if (noRolls) fireAutoAdvance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rollCurrent = useCallback(async () => {
    if (isLocked.current || phase !== "rolling") return;
    isLocked.current = true;
    setPhase("resolving");

    const result = await resolveRoll(gameId, turnId);

    if (!result.success || !result.roll) {
      setError(result.error ?? "Roll failed.");
      setPhase("rolling");
      isLocked.current = false;
      return;
    }

    const updatedRolls = result.rolls ?? rolls.map((r, i) => i === currentRollIndex ? result.roll! : r);
    setRolls(updatedRolls);

    if (result.completed) {
      isLocked.current = false;
      fireAutoAdvance();
    } else {
      let nextIdx = currentRollIndex + 1;
      while (nextIdx < updatedRolls.length && updatedRolls[nextIdx].skipped) nextIdx++;
      setCurrentRollIndex(nextIdx);
      setPhase("rolling");
      isLocked.current = false;
    }
  }, [gameId, turnId, rolls, currentRollIndex, phase, fireAutoAdvance]);

  return { phase, rolls, currentRollIndex, error, rollCurrent };
}
