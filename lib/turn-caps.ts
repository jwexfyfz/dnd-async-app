import { CHARACTER_BASELINES, type SupportedClass } from "@/config/classRules";

export interface TurnActionCaps {
  maxAction:       number;
  maxBonusAction:  number;
  maxMovementFeet: number;
}

/**
 * Pure cap calculation — no React dependencies.
 * Imported by useTurnActions (client) and reset-character-round (server).
 */
export function computeCaps(characterClass: string, level: number): TurnActionCaps {
  const cls      = characterClass.toLowerCase() as SupportedClass;
  const baseline = CHARACTER_BASELINES[cls] ?? { baseActions: 1, baseBonusActions: 1, baseSpeedSteps: 6 };

  let maxAction       = baseline.baseActions;
  let maxBonusAction  = baseline.baseBonusActions;
  let maxMovementFeet = baseline.baseSpeedSteps * 5; // steps → feet

  // Fighter: Action Surge at level 2 grants one additional action per turn
  if (cls === "fighter" && level >= 2) {
    maxAction += 1;
  }

  // Barbarian: Fast Movement at level 5 adds 10 ft to speed
  if (cls === "barbarian" && level >= 5) {
    maxMovementFeet += 10;
  }

  return { maxAction, maxBonusAction, maxMovementFeet };
}
