"use client";

import { useState, useEffect } from "react";
import type { ActiveRollContext } from "./roll-context";

export type { ActiveRollContext };

type Listener = (ctx: ActiveRollContext | null) => void;

let _ctx: ActiveRollContext | null = null;
const _listeners = new Set<Listener>();

export const activeRollContextStore = {
  get: (): ActiveRollContext | null => _ctx,
  set: (next: ActiveRollContext | null): void => {
    _ctx = next;
    _listeners.forEach((l) => l(next));
  },
  subscribe: (l: Listener): (() => void) => {
    _listeners.add(l);
    return () => _listeners.delete(l);
  },
};

export function useActiveRollContext() {
  const [ctx, setCtx] = useState<ActiveRollContext | null>(activeRollContextStore.get());
  useEffect(() => activeRollContextStore.subscribe(setCtx), []);
  return {
    activeRollContext: ctx,
    setActiveRollContext: activeRollContextStore.set,
    clearRollContext: () => activeRollContextStore.set(null),
  };
}
