"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { TurnCostType } from "@/types/turn-actions";
import { computeCaps } from "@/lib/turn-caps";

export type { TurnCostType };
export { computeCaps };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResourcePool {
  current: number;
  max: number;
}

interface TurnActionState {
  mainAction:   ResourcePool;
  bonusAction:  ResourcePool;
  movementFeet: ResourcePool;
}

interface InitialRemaining {
  remainingActions:      number;
  remainingBonusActions: number;
  remainingMovementFeet: number;
}

interface StoredRemaining {
  remainingActions:      number;
  remainingBonusActions: number;
  remainingMovementFeet: number;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function readStorage(key: string): StoredRemaining | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredRemaining) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, s: TurnActionState): void {
  try {
    localStorage.setItem(key, JSON.stringify({
      remainingActions:      s.mainAction.current,
      remainingBonusActions: s.bonusAction.current,
      remainingMovementFeet: s.movementFeet.current,
    }));
  } catch { /* private browsing or storage full — silently skip */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTurnActions(
  characterClass:    string,
  level:             number,
  characterId:       string,
  initialRemaining?: InitialRemaining,
) {
  const caps = useMemo(
    () => computeCaps(characterClass, level),
    [characterClass, level],
  );

  const storageKey = `turn_state_${characterId}`;

  const [state, setState] = useState<TurnActionState>(() => {
    const stored = readStorage(storageKey);
    console.log("[useTurnActions] init", {
      characterId,
      caps: { maxAction: caps.maxAction, maxBonusAction: caps.maxBonusAction, maxMovementFeet: caps.maxMovementFeet },
      initialRemaining,
      stored,
      source: stored ? "localStorage" : "DB/defaults",
    });
    if (stored) {
      return {
        mainAction:   { current: Math.min(stored.remainingActions,      caps.maxAction),       max: caps.maxAction       },
        bonusAction:  { current: Math.min(stored.remainingBonusActions, caps.maxBonusAction),  max: caps.maxBonusAction  },
        movementFeet: { current: Math.min(stored.remainingMovementFeet, caps.maxMovementFeet), max: caps.maxMovementFeet },
      };
    }
    return {
      mainAction:   { current: initialRemaining?.remainingActions      ?? caps.maxAction,       max: caps.maxAction       },
      bonusAction:  { current: initialRemaining?.remainingBonusActions ?? caps.maxBonusAction,  max: caps.maxBonusAction  },
      movementFeet: { current: initialRemaining?.remainingMovementFeet ?? caps.maxMovementFeet, max: caps.maxMovementFeet },
    };
  });

  // Clear localStorage on unmount so returning to the URL reads from DB.
  useEffect(() => {
    console.log("[useTurnActions] mounted, storageKey:", storageKey);
    return () => {
      console.log("[useTurnActions] unmounting — clearing localStorage key:", storageKey);
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    };
  }, [storageKey]);

  // Reset to max only when caps genuinely change (e.g. level-up).
  // Comparing previous vs current caps — rather than a "did mount" flag —
  // is immune to React Strict Mode's double-fire, which would cause the flag
  // approach to reset state to max on every page load in development.
  const prevCapsRef = useRef<{ a: number; b: number; m: number } | null>(null);
  useEffect(() => {
    const prev = prevCapsRef.current;
    const curr = { a: caps.maxAction, b: caps.maxBonusAction, m: caps.maxMovementFeet };
    prevCapsRef.current = curr;
    if (!prev || (prev.a === curr.a && prev.b === curr.b && prev.m === curr.m)) {
      console.log("[useTurnActions] caps effect: first mount or no change — preserving initial state", curr);
      return;
    }
    console.log("[useTurnActions] caps genuinely changed (level-up?) — resetting to max", { prev, curr });
    const next: TurnActionState = {
      mainAction:   { current: caps.maxAction,       max: caps.maxAction       },
      bonusAction:  { current: caps.maxBonusAction,  max: caps.maxBonusAction  },
      movementFeet: { current: caps.maxMovementFeet, max: caps.maxMovementFeet },
    };
    writeStorage(storageKey, next);
    setState(next);
  }, [caps.maxAction, caps.maxBonusAction, caps.maxMovementFeet, storageKey]);

  // Returns true if the pool has enough remaining to cover the cost.
  const evaluateActionCost = useCallback(
    (costType: TurnCostType, value: number): boolean => {
      if (costType === "free") return true;
      return state[costType].current >= value;
    },
    [state],
  );

  // Subtracts value from the named pool and persists immediately to localStorage.
  // Also fires a keepalive DB sync so the value survives cross-device / incognito.
  const consumeResource = useCallback(
    (costType: TurnCostType, value: number): void => {
      if (costType === "free") return;
      setState((prev) => {
        const next: TurnActionState = {
          ...prev,
          [costType]: {
            ...prev[costType],
            current: Math.max(0, prev[costType].current - value),
          },
        };
        writeStorage(storageKey, next);
        return next;
      });
      fetch("/api/turn/sync-consumed", {
        method:    "POST",
        headers:   { "Content-Type": "application/json" },
        body:      JSON.stringify({ characterId, costType, value }),
        keepalive: true,
      }).catch(() => {/* DB sync is best-effort; localStorage is source of truth */});
    },
    [characterId, storageKey],
  );

  // Restores every pool to its max and clears the stored mid-turn state.
  const resetTurnActions = useCallback((): void => {
    setState((prev) => {
      const next: TurnActionState = {
        mainAction:   { current: prev.mainAction.max,   max: prev.mainAction.max   },
        bonusAction:  { current: prev.bonusAction.max,  max: prev.bonusAction.max  },
        movementFeet: { current: prev.movementFeet.max, max: prev.movementFeet.max },
      };
      writeStorage(storageKey, next);
      return next;
    });
    fetch("/api/turn/reset-round", {
      method:    "POST",
      headers:   { "Content-Type": "application/json" },
      body:      JSON.stringify({ characterId }),
      keepalive: true,
    }).catch(() => {/* fire-and-forget */});
  }, [characterId, storageKey]);

  return {
    mainAction:         state.mainAction,
    bonusAction:        state.bonusAction,
    movementFeet:       state.movementFeet,
    evaluateActionCost,
    consumeResource,
    resetTurnActions,
  };
}
