import type { ChipType } from "./chips";

export type AdvantageState = "NONE" | "ADVANTAGE" | "DISADVANTAGE";
export type RollType       = "ATTACK" | "DAMAGE" | "SAVING_THROW" | "ABILITY_CHECK";
export type ActionType     = "mainAction" | "bonusAction" | "movement" | "free";

// One entry in the activeTurnQueue.rolls array.
export interface QueueRoll {
  id:                     string;
  type:                   RollType;
  actorName:              string;
  label:                  string;
  diceFormula:            string;  // e.g. "1d20+5", "1d8+3"
  dc:                     number | null;
  advantageState:         AdvantageState;
  naturalResult:          number | null;
  secondaryNaturalResult: number | null;
  totalResult:            number | null;
  isSuccess:              boolean | null;
  skipped:                boolean;  // auto-skipped (e.g. miss → skip damage)
  targetEnemyId?:         string;   // attack rolls only — enemy being targeted
}

// Replaces the legacy Chip type for chips stored in Game.activeSuggestionChips.
// The legacy Chip type and game.state.active_suggestion_chips remain in use
// until Phase C cuts the frontend over to the new path.
export interface SuggestionChip {
  id:             string;          // server-assigned UUID
  label:          string;          // display text (replaces legacy chip.text)
  type:           ChipType;        // "none" suppresses modifier badge
  requiresRoll:   boolean;
  advantageState: AdvantageState;
  action_type:    ActionType;
  movementFeet:   number;          // 0 unless action_type === "movement"
  spellLevel:     number;          // 0 for cantrips/martial; >0 for leveled spells
  endPosition:    { x: number; y: number };   // destination tile (playerPos for non-movement)
  actionTarget:   { x: number; y: number };   // target tile (playerPos for self-targeting)
  itemId?:        string;                     // map item ID to pick up when chip is executed
}
